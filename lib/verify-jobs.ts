/**
 * TRABAJOS DE VERIFICACIÓN DE EMAILS — en segundo plano.
 *
 * En vez de una conexión SSE larga (que los proxies cortan → "Error
 * verificando"), lanzamos un trabajo que corre por detrás y la pantalla
 * consulta su progreso por polling. Mismo patrón que la personalización.
 *
 * El estado vive en memoria del proceso (Map). Si el server se reinicia a
 * mitad, el trabajo se pierde y el usuario simplemente lo relanza.
 */
import { randomUUID } from "crypto";
import { readCSVRows } from "./personalization";
import { verifyBatch, normalizeEmail, isValidSyntax, type VerifyResult } from "./email-verify";
import { writeBlob } from "./storage";

export type VerifyJob = {
  id: string;
  status: "running" | "done" | "error";
  phase: "verifying" | "building" | "done";
  done: number;
  total: number;
  total_rows: number;
  error?: string;
  result?: {
    summary: {
      total_rows: number; unique_emails: number;
      valid: number; risky: number; unknown: number; invalid: number;
      duplicates: number; removed: number; kept: number; smtp_available: boolean;
    };
    clean_file_id: string;
    clean_filename: string;
    clean_row_count: number;
    columns: string[];
    invalid_samples: Array<{ email: string; reason: string }>;
  };
  updated_at: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __verifyJobs: Map<string, VerifyJob> | undefined;
}
const jobs: Map<string, VerifyJob> = (globalThis.__verifyJobs ||= new Map());

// Limpieza: borrar trabajos terminados de hace > 30 min para no acumular RAM.
function gc() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, j] of jobs) {
    if (j.status !== "running" && j.updated_at < cutoff) jobs.delete(id);
  }
}

export function createVerifyJob(): VerifyJob {
  gc();
  const job: VerifyJob = {
    id: randomUUID(), status: "running", phase: "verifying",
    done: 0, total: 0, total_rows: 0, updated_at: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getVerifyJob(id: string): VerifyJob | null {
  return jobs.get(id) ?? null;
}

function patch(id: string, p: Partial<VerifyJob>) {
  const j = jobs.get(id);
  if (!j) return;
  Object.assign(j, p, { updated_at: Date.now() });
}

function csvEscape(v: string): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function serializeCSV(columns: string[], rows: Record<string, string>[]): string {
  const head = columns.map(csvEscape).join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c] ?? "")).join(",")).join("\n");
  return body ? `${head}\n${body}` : head;
}

/** Ejecuta el trabajo de verificación EN SEGUNDO PLANO (no se await desde la ruta). */
export async function runVerifyJob(
  jobId: string,
  params: { file_id: string; emailColumn: string; filename: string; smtp: boolean }
): Promise<void> {
  try {
    const { columns, rows } = await readCSVRows(params.file_id);
    if (!columns.includes(params.emailColumn)) {
      patch(jobId, { status: "error", error: `La columna "${params.emailColumn}" no existe en el CSV` });
      return;
    }
    patch(jobId, { total_rows: rows.length });

    // Emails únicos a verificar.
    const uniqueEmails: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const e = normalizeEmail(r[params.emailColumn]);
      if (e && !seen.has(e)) { seen.add(e); uniqueEmails.push(e); }
    }
    patch(jobId, { total: uniqueEmails.length });

    const { results } = await verifyBatch(uniqueEmails, {
      smtp: params.smtp,
      concurrency: 30,
      onProgress: (d, t) => patch(jobId, { done: d, total: t }),
    });
    const statusByEmail = new Map<string, VerifyResult>();
    for (const r of results) statusByEmail.set(r.email, r);
    const smtpAvailable = results.some((r) => r.smtp_checked);

    // Construir CSV limpio (dedup a nivel de fila + quitar inválidos).
    patch(jobId, { phase: "building" });
    const seenRows = new Set<string>();
    const cleanRows: Record<string, string>[] = [];
    const counts = { valid: 0, risky: 0, unknown: 0, invalid: 0, duplicates: 0 };
    const invalidSamples: Array<{ email: string; reason: string }> = [];

    for (const r of rows) {
      const e = normalizeEmail(r[params.emailColumn]);
      if (!e || !isValidSyntax(e)) {
        counts.invalid++;
        if (invalidSamples.length < 25 && e) invalidSamples.push({ email: e, reason: "formato/sin email" });
        continue;
      }
      if (seenRows.has(e)) { counts.duplicates++; continue; }
      seenRows.add(e);
      const res = statusByEmail.get(e);
      const status = res?.status ?? "unknown";
      if (status === "invalid") {
        counts.invalid++;
        if (invalidSamples.length < 25) invalidSamples.push({ email: e, reason: res?.reason || "inválido" });
        continue;
      }
      cleanRows.push({ ...r, email_status: status, email_status_reason: res?.reason || "" });
      if (status === "valid") counts.valid++;
      else if (status === "risky") counts.risky++;
      else counts.unknown++;
    }

    const cleanColumns = columns.includes("email_status") ? columns : [...columns, "email_status", "email_status_reason"];
    const cleanCsv = serializeCSV(cleanColumns, cleanRows);
    const cleanFileId = randomUUID();
    await writeBlob(`csv/${cleanFileId}`, Buffer.from(cleanCsv, "utf-8"), "text/csv");

    patch(jobId, {
      status: "done", phase: "done",
      result: {
        summary: {
          total_rows: rows.length,
          unique_emails: uniqueEmails.length,
          valid: counts.valid, risky: counts.risky, unknown: counts.unknown,
          invalid: counts.invalid, duplicates: counts.duplicates,
          removed: counts.invalid + counts.duplicates, kept: cleanRows.length,
          smtp_available: smtpAvailable,
        },
        clean_file_id: cleanFileId,
        clean_filename: params.filename.replace(/\.csv$/i, "") + "_verificado.csv",
        clean_row_count: cleanRows.length,
        columns: cleanColumns,
        invalid_samples: invalidSamples,
      },
    });
  } catch (e: any) {
    patch(jobId, { status: "error", error: e?.message || String(e) });
  }
}
