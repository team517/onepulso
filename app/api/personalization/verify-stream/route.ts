import { withRequestTenant } from "@/lib/client-auth";
import { NextRequest } from "next/server";
import { readCSVRows } from "@/lib/personalization";
import { verifyBatch, normalizeEmail, isValidSyntax, type VerifyResult } from "@/lib/email-verify";
import { writeBlob } from "@/lib/storage";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * GET /api/personalization/verify-stream?file_id=X&email_column=Y[&smtp=0]
 * SSE: verifica los emails del CSV (formato + MX/DNS + SMTP + duplicados) y
 * genera un CSV LIMPIO (quita inválidos y duplicados; deja válidos/arriesgados/
 * no-comprobables).
 *
 * Eventos:
 *  - progress → { done, total }
 *  - done     → { summary, clean_file_id, clean_filename, clean_row_count, columns, samples }
 *  - error    → { message }
 */
function csvEscape(v: string): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function serializeCSV(columns: string[], rows: Record<string, string>[]): string {
  const head = columns.map(csvEscape).join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c] ?? "")).join(",")).join("\n");
  return body ? `${head}\n${body}` : head;
}

export async function GET(req: NextRequest) {
  return withRequestTenant(req as any, async () => {
  const url = new URL(req.url);
  const file_id = url.searchParams.get("file_id");
  const emailColumn = url.searchParams.get("email_column") || "";
  const filename = url.searchParams.get("filename") || "leads";
  const wantSmtp = url.searchParams.get("smtp") !== "0";
  if (!file_id || !emailColumn) return new Response("file_id y email_column requeridos", { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: any) => {
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {}
      };
      // LATIDO: una señal cada 10s para que ningún proxy corte la conexión por
      // estar "callada" durante sondeos SMTP lentos o al generar el CSV final.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch {}
      }, 10_000);
      const stop = () => { closed = true; clearInterval(heartbeat); try { controller.close(); } catch {} };
      try {
        const { columns, rows } = await readCSVRows(file_id);
        if (!columns.includes(emailColumn)) {
          send("error", { message: `La columna "${emailColumn}" no existe en el CSV` });
          stop();
          return;
        }

        // Emails únicos a verificar (dedup para no repetir trabajo de red).
        const uniqueEmails: string[] = [];
        const seenForVerify = new Set<string>();
        for (const r of rows) {
          const e = normalizeEmail(r[emailColumn]);
          if (e && !seenForVerify.has(e)) { seenForVerify.add(e); uniqueEmails.push(e); }
        }

        send("start", { total: uniqueEmails.length, total_rows: rows.length });

        // Verificación EFICIENTE: agrupada por dominio, 1 conexión SMTP por
        // dominio, alta concurrencia (ver lib/email-verify.ts).
        let lastSent = 0;
        const { results, summary: batchSummary } = await verifyBatch(uniqueEmails, {
          smtp: wantSmtp,
          concurrency: 30,
          onProgress: (d, t) => {
            // Emitir progreso como mucho cada 50 para no saturar el SSE.
            if (d - lastSent >= 50 || d === t) { lastSent = d; send("progress", { done: d, total: t }); }
          },
        });
        const statusByEmail = new Map<string, VerifyResult>();
        for (const r of results) statusByEmail.set(r.email, r);
        const smtpAvailable = batchSummary.smtp_available;

        // Fase de construcción del CSV limpio (avisamos para que no parezca colgado).
        send("phase", { phase: "building" });

        // Reconstruir a nivel de FILA: dedup (1ª ocurrencia) + quitar inválidos.
        const seenRows = new Set<string>();
        const cleanRows: Record<string, string>[] = [];
        const counts = { valid: 0, risky: 0, unknown: 0, invalid: 0, duplicates: 0, no_email: 0 };
        const invalidSamples: Array<{ email: string; reason: string }> = [];

        for (const r of rows) {
          const e = normalizeEmail(r[emailColumn]);
          if (!e || !isValidSyntax(e)) { counts.no_email++; counts.invalid++; if (invalidSamples.length < 25 && e) invalidSamples.push({ email: e, reason: "formato/sin email" }); continue; }
          if (seenRows.has(e)) { counts.duplicates++; continue; }
          seenRows.add(e);
          const res = statusByEmail.get(e);
          const status = res?.status ?? "unknown";
          if (status === "invalid") {
            counts.invalid++;
            if (invalidSamples.length < 25) invalidSamples.push({ email: e, reason: res?.reason || "inválido" });
            continue;
          }
          // Guardamos el veredicto en una columna extra para transparencia.
          const out = { ...r, email_status: status, email_status_reason: res?.reason || "" };
          cleanRows.push(out);
          if (status === "valid") counts.valid++;
          else if (status === "risky") counts.risky++;
          else counts.unknown++;
        }

        // Escribir CSV limpio como nuevo blob (no toca el original).
        const cleanColumns = columns.includes("email_status") ? columns : [...columns, "email_status", "email_status_reason"];
        const cleanCsv = serializeCSV(cleanColumns, cleanRows);
        const cleanFileId = randomUUID();
        await writeBlob(`csv/${cleanFileId}`, Buffer.from(cleanCsv, "utf-8"), "text/csv");

        send("done", {
          summary: {
            total_rows: rows.length,
            unique_emails: uniqueEmails.length,
            valid: counts.valid,
            risky: counts.risky,
            unknown: counts.unknown,
            invalid: counts.invalid,
            duplicates: counts.duplicates,
            removed: counts.invalid + counts.duplicates,
            kept: cleanRows.length,
            smtp_available: smtpAvailable,
          },
          clean_file_id: cleanFileId,
          clean_filename: filename.replace(/\.csv$/i, "") + "_verificado.csv",
          clean_row_count: cleanRows.length,
          columns: cleanColumns,
          invalid_samples: invalidSamples,
        });
      } catch (e: any) {
        send("error", { message: e?.message || String(e) });
      } finally {
        stop();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });

  }) as any;
}
