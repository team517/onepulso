/**
 * Personalización masiva de mensajes a partir de un CSV de leads.
 * Flujo:
 *  1. Usuario sube CSV → file_id (lib/csv.ts ya lo persiste en blob_store)
 *  2. Mapea columnas → first_name, company_name, industry, city, description, email
 *  3. Escribe un prompt con placeholders {firstName} {companyName} etc.
 *  4. Preview con 1 lead
 *  5. Run en N leads → resultados guardados en kv_store
 *  6. Descargar CSV con la columna nueva 'personalized_message'
 */
import { randomUUID } from "crypto";
import { readJson, writeJson, readBlob, writeBlob } from "./storage";
import { generateText, AIProvider } from "./ai-providers";

const JOBS_PREFIX = "personalization-job/";
const JOBS_INDEX = "personalization-jobs-index";

export type ColumnMapping = {
  first_name?: string;
  company_name?: string;
  industry?: string;
  city?: string;
  description?: string;
  email?: string;
  // permitir mapear columnas custom extra
  [key: string]: string | undefined;
};

export type PersonalizationJob = {
  id: string;
  file_id: string;
  filename: string;
  total_rows: number;
  selected_rows: number[];
  mapping: ColumnMapping;
  prompt: string;
  provider: AIProvider;
  status: "pending" | "running" | "done" | "error" | "cancelled";
  progress: { done: number; ok: number; failed: number };
  error?: string;
  created_at: string;
  updated_at: string;
  results: Array<{ row_index: number; message: string; error?: string; lead_email?: string }>;
  result_csv_key?: string;
};

export async function listJobs(): Promise<PersonalizationJob[]> {
  const ids = (await readJson<string[]>(JOBS_INDEX)) ?? [];
  const out: PersonalizationJob[] = [];
  for (const id of ids) {
    const j = await readJson<PersonalizationJob>(`${JOBS_PREFIX}${id}`);
    if (j) out.push(j);
  }
  return out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export async function getJob(id: string): Promise<PersonalizationJob | null> {
  return await readJson<PersonalizationJob>(`${JOBS_PREFIX}${id}`);
}

async function saveJob(j: PersonalizationJob) {
  await writeJson(`${JOBS_PREFIX}${j.id}`, j);
  const ids = (await readJson<string[]>(JOBS_INDEX)) ?? [];
  if (!ids.includes(j.id)) {
    ids.unshift(j.id);
    await writeJson(JOBS_INDEX, ids.slice(0, 100)); // máx 100 jobs en historial
  }
}

export async function deleteJob(id: string): Promise<void> {
  const ids = (await readJson<string[]>(JOBS_INDEX)) ?? [];
  await writeJson(JOBS_INDEX, ids.filter((x) => x !== id));
}

/**
 * Detecta jobs en estado "running" que llevan más de 5 min sin actualizar
 * el progreso (probablemente interrumpidos por restart del servidor).
 * Los marca como "interrupted" para que el usuario pueda reanudarlos.
 */
export async function detectInterruptedJobs(): Promise<number> {
  const all = await listJobs();
  let touched = 0;
  const STALE_MS = 5 * 60 * 1000;
  const now = Date.now();
  for (const j of all) {
    if (j.status !== "running") continue;
    const updated = new Date(j.updated_at).getTime();
    if (now - updated > STALE_MS) {
      (j as any).status = "interrupted";
      j.updated_at = new Date().toISOString();
      await writeJson(`${JOBS_PREFIX}${j.id}`, j);
      touched++;
    }
  }
  return touched;
}

/**
 * Reanuda un job interrumpido: identifica las filas que NO se procesaron y
 * llama a runJob con solo esas filas restantes. Mantiene los results ya hechos.
 */
export async function resumeJob(jobId: string): Promise<PersonalizationJob> {
  const job = await getJob(jobId);
  if (!job) throw new Error("Job no encontrado");
  if (job.status === "running") throw new Error("El job ya está corriendo");
  if (job.status === "done") return job;

  // Detectar filas ya procesadas (en results)
  const doneIndices = new Set(job.results.map((r) => r.row_index));
  const pending = job.selected_rows.filter((i) => !doneIndices.has(i));
  if (pending.length === 0) {
    // Todo procesado, solo falta marcar como done y generar CSV si no existe
    const { rows } = await readCSVRows(job.file_id);
    if (!job.result_csv_key) {
      job.result_csv_key = `personalization-result/${job.id}.csv`;
      await buildResultCSV(job, rows);
    }
    job.status = "done";
    job.updated_at = new Date().toISOString();
    await saveJob(job);
    return job;
  }

  // Reanudar procesando solo las pendientes
  job.selected_rows = pending;
  // No reseteamos results — mantenemos los que ya hay
  // El progress.done seguirá sumando desde donde estaba (los pending son nuevos)
  job.status = "running";
  await saveJob(job);
  return await runJob(jobId);
}

/** Aplica un mapping de columnas y un row a un prompt con placeholders. */
export function applyMapping(prompt: string, row: Record<string, string>, mapping: ColumnMapping): string {
  let out = prompt;
  // Standard placeholders
  const placeholders: Record<string, string> = {
    firstName: getMappedValue(row, mapping, "first_name"),
    first_name: getMappedValue(row, mapping, "first_name"),
    companyName: getMappedValue(row, mapping, "company_name"),
    company_name: getMappedValue(row, mapping, "company_name"),
    industry: getMappedValue(row, mapping, "industry"),
    city: getMappedValue(row, mapping, "city"),
    description: getMappedValue(row, mapping, "description"),
    email: getMappedValue(row, mapping, "email"),
  };
  // Y CUALQUIER columna del CSV literalmente como {NombreColumna}
  for (const [col, val] of Object.entries(row)) {
    placeholders[col] = val;
  }
  // Reemplazar {key} y {{key}}
  for (const [k, v] of Object.entries(placeholders)) {
    const re1 = new RegExp(`\\{\\{\\s*${escapeRegExp(k)}\\s*\\}\\}`, "g");
    const re2 = new RegExp(`\\{\\s*${escapeRegExp(k)}\\s*\\}`, "g");
    out = out.replace(re1, v).replace(re2, v);
  }
  return out;
}

function getMappedValue(row: Record<string, string>, mapping: ColumnMapping, field: keyof ColumnMapping): string {
  const col = mapping[field];
  if (!col) return "";
  return row[col] ?? "";
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sistema por defecto para el LLM */
const DEFAULT_SYSTEM = `Eres un experto en cold email B2B. Generas mensajes personalizados, naturales, en español de España (a menos que el prompt indique otro idioma), sin floritura ni clichés. Tu output es SOLO el mensaje final que se enviará al lead, sin meta-comentarios ni explicaciones.`;

/** Genera un mensaje personalizado para un row concreto. Usado por preview y por el job runner. */
export async function generateForRow(
  prompt: string,
  row: Record<string, string>,
  mapping: ColumnMapping,
  provider: AIProvider,
): Promise<string> {
  const final = applyMapping(prompt, row, mapping);
  const result = await generateText({
    provider,
    system: DEFAULT_SYSTEM,
    prompt: final,
    maxTokens: 1200,
    temperature: 0.75,
  });
  return result;
}

/** Lee el CSV completo como array de objetos {col: val} */
export async function readCSVRows(file_id: string): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
  const blob = await readBlob(`csv/${file_id}`);
  if (!blob) throw new Error(`CSV no encontrado: ${file_id}`);
  const text = blob.data.toString("utf-8");
  const arr = parseCSV(text);
  const columns = arr[0] ?? [];
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < arr.length; i++) {
    const r = arr[i];
    const obj: Record<string, string> = {};
    columns.forEach((c, j) => (obj[c] = r[j] ?? ""));
    rows.push(obj);
  }
  return { columns, rows };
}

/** Crea un job nuevo y lo deja en estado pending. */
export async function createJob(input: {
  file_id: string;
  filename: string;
  total_rows: number;
  selected_rows: number[];
  mapping: ColumnMapping;
  prompt: string;
  provider: AIProvider;
}): Promise<PersonalizationJob> {
  const now = new Date().toISOString();
  const job: PersonalizationJob = {
    id: randomUUID(),
    file_id: input.file_id,
    filename: input.filename,
    total_rows: input.total_rows,
    selected_rows: input.selected_rows,
    mapping: input.mapping,
    prompt: input.prompt,
    provider: input.provider,
    status: "pending",
    progress: { done: 0, ok: 0, failed: 0 },
    created_at: now,
    updated_at: now,
    results: [],
  };
  await saveJob(job);
  return job;
}

/** Ejecuta un job procesando filas EN PARALELO en lotes.
 *  Con concurrencia 6, 1000 leads se procesan en ~3-4 min en vez de 50.
 *  Persiste el estado tras cada lote para que el progreso sea visible. */
export async function runJob(jobId: string, onProgress?: (j: PersonalizationJob) => void): Promise<PersonalizationJob> {
  let job = await getJob(jobId);
  if (!job) throw new Error("Job no encontrado");
  if (job.status === "running") throw new Error("Job ya en ejecución");

  job.status = "running";
  job.updated_at = new Date().toISOString();
  await saveJob(job);

  const { rows } = await readCSVRows(job.file_id);
  const CONCURRENCY = 6; // 6 llamadas LLM simultáneas (balance velocidad vs rate-limit)

  for (let i = 0; i < job.selected_rows.length; i += CONCURRENCY) {
    const batch = job.selected_rows.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (idx) => {
        const row = rows[idx];
        if (!row) return { idx, message: "", error: "Fila fuera de rango" };
        try {
          const msg = await generateForRow(job!.prompt, row, job!.mapping, job!.provider);
          const email = job!.mapping.email ? row[job!.mapping.email] : undefined;
          return { idx, message: msg, lead_email: email };
        } catch (e: any) {
          return { idx, message: "", error: e.message };
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        const v = r.value;
        if (v.error) {
          job.results.push({ row_index: v.idx, message: "", error: v.error });
          job.progress.failed++;
        } else {
          job.results.push({ row_index: v.idx, message: v.message, lead_email: v.lead_email });
          job.progress.ok++;
        }
      } else {
        job.progress.failed++;
      }
      job.progress.done++;
    }
    job.updated_at = new Date().toISOString();
    await saveJob(job);
    if (onProgress) onProgress(job);
  }

  // Generar CSV resultado
  job.result_csv_key = `personalization-result/${job.id}.csv`;
  await buildResultCSV(job, rows);

  job.status = "done";
  job.updated_at = new Date().toISOString();
  await saveJob(job);
  return job;
}

/** Genera el CSV resultado con todas las columnas originales + personalized_message */
async function buildResultCSV(job: PersonalizationJob, allRows: Record<string, string>[]) {
  // Mapa row_index → message
  const messageMap = new Map<number, string>();
  for (const r of job.results) {
    if (!r.error) messageMap.set(r.row_index, r.message);
    else messageMap.set(r.row_index, `[ERROR: ${r.error}]`);
  }
  // Columnas: las originales + personalized_message al final
  const cols = allRows.length > 0 ? Object.keys(allRows[0]) : [];
  const headerCols = [...cols, "personalized_message"];

  const lines: string[] = [headerCols.map(csvEscape).join(",")];
  // Solo escribimos las filas seleccionadas
  for (const idx of job.selected_rows) {
    const row = allRows[idx];
    if (!row) continue;
    const vals = cols.map((c) => csvEscape(row[c] ?? ""));
    vals.push(csvEscape(messageMap.get(idx) ?? ""));
    lines.push(vals.join(","));
  }
  const csv = lines.join("\r\n");
  await writeBlob(job.result_csv_key!, Buffer.from(csv, "utf-8"), "text/csv");
}

function csvEscape(s: string): string {
  if (s == null) return "";
  const str = String(s);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Mini parser CSV (mismo que csv.ts, duplicado para no importar)
function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  const semicolonCount = (firstLine.match(/;/g) ?? []).length;
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  let delim = ",";
  if (semicolonCount > commaCount && semicolonCount >= tabCount) delim = ";";
  else if (tabCount > commaCount && tabCount > semicolonCount) delim = "\t";

  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;
  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === delim) { cur.push(field); field = ""; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; i++; continue; }
    field += ch; i++;
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  while (rows.length > 0 && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
  return rows;
}
