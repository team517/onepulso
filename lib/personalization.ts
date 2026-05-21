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
import Papa from "papaparse";
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
  /** Filas pendientes de procesar (se va recortando según avanza el resume). */
  selected_rows: number[];
  /** Filas seleccionadas originalmente (inmutable, sirve para Reiniciar). */
  original_selected_rows?: number[];
  mapping: ColumnMapping;
  prompt: string;
  provider: AIProvider;
  status: "pending" | "running" | "done" | "error" | "cancelled" | "interrupted" | "paused";
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
 * Detecta jobs en estado "running" que llevan más de 2 min sin actualizar
 * el progreso (probablemente interrumpidos por restart del servidor o un
 * lote LLM colgado). Los marca como "interrupted" para que el watchdog
 * los reanude automáticamente.
 */
export async function detectInterruptedJobs(staleMinutes = 2): Promise<number> {
  const all = await listJobs();
  let touched = 0;
  const STALE_MS = staleMinutes * 60 * 1000;
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
 * Watchdog: arranca un loop que cada N ms:
 *  1) Marca jobs running-pero-sin-progreso como "interrupted".
 *  2) Reanuda automáticamente cualquier job en estado "interrupted".
 *
 * Se llama desde instrumentation.ts al arrancar el servidor. Idempotente.
 */
declare global {
  // eslint-disable-next-line no-var
  var __personalizationWatchdog: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __personalizationWatchdogRunning: boolean | undefined;
}

export function startPersonalizationWatchdog(intervalMs = 60_000) {
  if (globalThis.__personalizationWatchdog) return;
  console.log(`[personalization-watchdog] starting (${intervalMs}ms tick — auto-resume jobs atascados)`);

  const safeTick = async () => {
    if (globalThis.__personalizationWatchdogRunning) return;
    globalThis.__personalizationWatchdogRunning = true;
    try {
      await watchdogTick();
    } catch (e: any) {
      console.error("[personalization-watchdog] tick error:", e?.message || e);
    } finally {
      globalThis.__personalizationWatchdogRunning = false;
    }
  };

  globalThis.__personalizationWatchdog = setInterval(safeTick, intervalMs);
  safeTick();
}

async function watchdogTick() {
  // 1) Marcar jobs running atascados (sin progreso >2 min) como interrupted
  const marked = await detectInterruptedJobs(2);
  if (marked > 0) console.log(`[personalization-watchdog] ${marked} jobs marcados como interrupted`);

  // 2) Buscar todos los interrupted y relanzarlos en background
  const all = await listJobs();
  for (const j of all) {
    if ((j as any).status !== "interrupted") continue;
    // Resume en background — no esperamos a que termine
    console.log(`[personalization-watchdog] auto-resume job ${j.id} (${j.progress.done}/${j.selected_rows.length})`);
    resumeJob(j.id).catch((e) => {
      console.error(`[personalization-watchdog] resume ${j.id} fallo:`, e?.message || e);
    });
  }
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
  // IMPORTANTE: dejamos status como "pending" (no "running"). runJob() se
  // encarga de setearlo a "running" — si lo hacemos aquí, runJob lanza error
  // "Job ya en ejecución" al detectar el estado.
  job.status = "pending";
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

/** Sistema por defecto para el LLM — fuerza estructura limpia con párrafos */
const DEFAULT_SYSTEM = `Eres un experto en cold email B2B. Generas mensajes personalizados, naturales, en español de España (a menos que el prompt indique otro idioma), sin floritura ni clichés.

REGLAS DE FORMATO (OBLIGATORIO, sin excepción):

1. El output va EN HTML con etiquetas <p>...</p> para cada bloque.
2. CADA idea va en su propio <p>. NUNCA mezcles varias frases largas en el mismo párrafo.
3. Estructura del mensaje:
   - <p>Saludo personalizado al lead</p>
   - <p>Gancho / observación específica sobre la empresa</p>
   - <p>Propuesta de valor concreta</p>
   - <p>(Opcional) Prueba social / caso de éxito con número</p>
   - <p>CTA claro</p>
   - <p>Firma</p>
4. Frases máximo 20 palabras. Bloques máximo 3 líneas.
5. Usa <strong>...</strong> en 1-3 palabras clave (gancho, número, CTA).
6. Para saltos suaves dentro de un párrafo, <br>.
7. Tu output es SOLO el HTML del cuerpo del mensaje, sin meta-comentarios, sin explicaciones, sin "Aquí tienes:".

EJEMPLO de output correcto:

<p>Hola Juan,</p>
<p>Vi que en <strong>Acme</strong> estáis escalando ventas con un equipo SDR de 4 personas en Madrid.</p>
<p>Nosotros ayudamos a SaaS B2B como vosotros a <strong>conseguir 4 reuniones semanales</strong> sin contratar más SDRs.</p>
<p>Con una empresa similar a la vuestra cerramos <strong>12 deals en 90 días</strong>.</p>
<p>¿Te va bien <strong>15 minutos esta semana</strong> para ver si encaja?</p>
<p>Un saludo,<br>Xavi</p>`;

/**
 * Estilo inline forzado para los <p> del email. Sin esto, Gmail/Outlook/
 * Apple Mail aplican su margin por defecto encima del del navegador y
 * los gaps entre párrafos se inflan al doble.
 *   - margin 0 0 6px 0   → gap mínimo entre párrafos, look compacto estilo
 *                          email humano (no maquetado HTML).
 *   - line-height 1.45   → legible pero más apretado, no infla la altura.
 *   - font: hereda del wrapper para no forzar fuente.
 */
const P_STYLE = 'style="margin:0 0 6px 0;line-height:1.45;"';

/** Aplica el style inline a todo <p> que no lo tenga ya. */
function applyParagraphStyles(html: string): string {
  // Eliminar <p>...</p> vacíos que producen huecos enormes en email
  html = html.replace(/<p[^>]*>\s*(?:&nbsp;)?\s*<\/p>/gi, "");
  // Reemplazar <br><br>+ por un solo <br> (gaps innecesarios)
  html = html.replace(/(<br\s*\/?>\s*){2,}/gi, "<br>");
  // Añadir style a <p> que no tiene atributo style
  html = html.replace(/<p(?![^>]*\bstyle=)([^>]*)>/gi, (_m, attrs) => `<p${attrs} ${P_STYLE}>`);
  return html;
}

/** Asegura que el output del LLM tiene estructura HTML con <p>.
 *  Si llega texto plano con saltos de línea, lo convierte a párrafos.
 *  Aplica style inline a cada <p> para que el email renderice igual que
 *  el preview en cualquier cliente (Gmail / Outlook / Apple Mail). */
function ensureStructuredOutput(raw: string): string {
  let s = raw.trim();
  // Si ya tiene <p>, lo dejamos pero aplicamos estilos inline.
  if (/<p[\s>]/i.test(s)) return applyParagraphStyles(s);
  // Quitar markdown code fences accidentales
  s = s.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "").trim();
  if (!s) return s;
  // Split por dobles saltos de línea (párrafos)
  const blocks = s.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > 1) {
    return applyParagraphStyles(blocks.map((b) => `<p>${b.replace(/\n/g, "<br>")}</p>`).join(""));
  }
  // Solo 1 bloque pero tiene saltos simples → cada línea es un párrafo
  const lines = s.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    return applyParagraphStyles(lines.map((l) => `<p>${l}</p>`).join(""));
  }
  return applyParagraphStyles(`<p>${s}</p>`);
}

/** Genera un mensaje personalizado para un row concreto. Usado por preview y por el job runner. */
export async function generateForRow(
  prompt: string,
  row: Record<string, string>,
  mapping: ColumnMapping,
  provider: AIProvider,
): Promise<string> {
  const final = applyMapping(prompt, row, mapping);
  const raw = await generateText({
    provider,
    system: DEFAULT_SYSTEM,
    prompt: final,
    maxTokens: 1200,
    temperature: 0.75,
  });
  // Post-procesar: garantizar estructura HTML con <p> aunque el LLM
  // devuelva texto plano con saltos de línea.
  return ensureStructuredOutput(raw);
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
    original_selected_rows: [...input.selected_rows], // copia para "Reiniciar"
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

/** Marca un job como "paused". El loop de runJob lo detecta al inicio del
 *  siguiente lote y aborta el procesamiento. El watchdog NO reanuda
 *  jobs pausados (sólo los "interrupted"). */
export async function pauseJob(jobId: string): Promise<PersonalizationJob | null> {
  const job = await getJob(jobId);
  if (!job) return null;
  if (job.status !== "running" && job.status !== "pending") return job;
  (job as any).status = "paused";
  job.updated_at = new Date().toISOString();
  await saveJob(job);
  return job;
}

/** Reinicia un job desde cero: limpia resultados, restaura selected_rows
 *  al conjunto original y lo deja en estado "pending". Lanza runJob en
 *  background si autoStart=true (por defecto). */
export async function restartJob(jobId: string, autoStart = true): Promise<PersonalizationJob | null> {
  const job = await getJob(jobId);
  if (!job) return null;
  const original = job.original_selected_rows ?? job.selected_rows;
  job.selected_rows = [...original];
  job.results = [];
  job.progress = { done: 0, ok: 0, failed: 0 };
  (job as any).status = "pending";
  job.error = undefined;
  job.result_csv_key = undefined;
  job.updated_at = new Date().toISOString();
  await saveJob(job);
  if (autoStart) {
    runJob(jobId).catch((e) => console.error(`[personalization] restart ${jobId} fatal:`, e?.message || e));
  }
  return job;
}

/** Ejecuta un job procesando filas EN PARALELO en lotes.
 *  Con concurrencia 6, 1000 leads se procesan en ~3-4 min en vez de 50.
 *  Persiste el estado tras cada lote para que el progreso sea visible.
 *  Comprueba al inicio de CADA lote si el job fue pausado o eliminado
 *  externamente — si es así, aborta limpiamente. */
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
    // CANCELACIÓN COOPERATIVA: antes de cada lote, re-leer el estado.
    // Si alguien (UI, watchdog) lo marcó como paused/cancelled/eliminado,
    // salimos limpiamente sin perder los results ya escritos.
    const fresh = await getJob(jobId);
    if (!fresh) {
      console.log(`[personalization] job ${jobId} eliminado durante ejecución — abortando`);
      return job;
    }
    if (fresh.status === "paused" || fresh.status === "cancelled") {
      console.log(`[personalization] job ${jobId} pausado/cancelado — abortando lote`);
      return fresh;
    }

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
    // Antes de guardar, re-verificar el estado en DB: si alguien pausó/canceló/
    // eliminó el job durante este lote, NO sobrescribimos su estado con "running".
    const latest = await getJob(jobId);
    if (!latest) {
      console.log(`[personalization] job ${jobId} eliminado durante lote — abortando sin guardar`);
      return job;
    }
    if (latest.status === "paused" || latest.status === "cancelled") {
      // Preservar el estado externo pero guardar el progreso conseguido.
      latest.results = job.results;
      latest.progress = job.progress;
      latest.updated_at = new Date().toISOString();
      await saveJob(latest);
      console.log(`[personalization] job ${jobId} pausado externamente — progreso guardado, abortando`);
      return latest;
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
  // Mapa row_index → message (aplicando estilos inline a los <p> para que el
  // email se vea como el preview, no con gaps gigantes entre párrafos).
  const messageMap = new Map<number, string>();
  for (const r of job.results) {
    if (!r.error) messageMap.set(r.row_index, applyParagraphStyles(r.message));
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

/**
 * Parser CSV usando Papa Parse con DOBLE pasada y auto-recuperación.
 * Ver explicación en lib/csv.ts (misma lógica duplicada para no importar
 * cruzado y no exportar funciones internas).
 */
function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const passA = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    delimiter: "",
    quoteChar: '"',
    escapeChar: '"',
  });
  const rowsA = (passA.data || []).filter((r) => r && r.length > 0);
  const hasQuoteErrors = (passA.errors || []).some((e) => e.code === "MissingQuotes" || e.type === "Quotes");
  if (!hasQuoteErrors) return rowsA;

  const passB = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    delimiter: "",
    quoteChar: String.fromCharCode(1),
  });
  const rowsB = (passB.data || []).filter((r) => r && r.length > 0);
  if (rowsB.length > rowsA.length * 1.5) {
    console.warn(`[csv personalization] comillas malformadas; fallback sin quoting (${rowsA.length} → ${rowsB.length} filas)`);
    return rowsB;
  }
  return rowsA;
}

