import { randomUUID } from "crypto";
import Papa from "papaparse";
import { readBlob, writeBlob, readJson, writeJson } from "./storage";

const CSV_BLOB_PREFIX = "csv/";
const CSV_META_PREFIX = "csv-meta/";

export type CSVMetadata = {
  file_id: string;
  filename: string;
  columns: string[];
  row_count: number;
  /** Columna(s) detectada(s) como email (al menos 30% de celdas con
   *  formato email válido en una muestra). */
  email_columns?: string[];
  /** Total de emails encontrados con formato válido user@host.tld */
  email_count?: number;
  /** Filas con al menos 1 email válido. */
  rows_with_email?: number;
  /** Total de símbolos @ (incluye handles sociales y otros @). Métrica de
   *  control cruzada con Excel — debería coincidir con tu cuenta visual. */
  at_symbols?: number;
  /** Desglose: cada columna y cuántos emails se encontraron en ella.
   *  Ordenado de mayor a menor. Permite al usuario ver dónde están los emails. */
  emails_by_column?: Array<{ column: string; count: number }>;
  /** Modo de parsing usado: incluye delimitador detectado y eventuales rescates. */
  parse_mode?: string;
  preview: Array<Record<string, string>>;
};

/**
 * Detección de email ULTRA PERMISIVA. Cuenta cualquier patrón
 *   <algo no-espacio>@<algo no-espacio>.<algo no-espacio>
 * sin restricciones de caracteres. Acepta:
 *  - Acentos en username (josé@empresa.es)
 *  - Internacionales (用户@日本.jp)
 *  - TLDs con números o exóticos
 *  - mailto: prefijos
 *  - Comillas/paréntesis alrededor
 *
 * Solo descartamos: handles sociales (@usuario sin dominio completo).
 */
const EMAIL_RE_GLOBAL = /[^\s,;<>"'()\[\]{}]+@[^\s,;<>"'()\[\]{}]+\.[^\s,;<>"'()\[\]{}]+/g;

/** ¿La celda contiene al menos UN email válido en cualquier posición? */
function isEmail(v: string): boolean {
  const s = String(v ?? "");
  if (!s.includes("@")) return false;
  EMAIL_RE_GLOBAL.lastIndex = 0;
  return EMAIL_RE_GLOBAL.test(s);
}

/** Cuenta todos los emails con formato user@host.tld en la celda. */
function countEmailsInCell(v: string): number {
  const s = String(v ?? "");
  if (!s.includes("@")) return 0;
  const m = s.match(EMAIL_RE_GLOBAL);
  return m ? m.length : 0;
}

/** Cuenta TODOS los símbolos @ — métrica de validación cruzada con Excel
 *  (=SUMPRODUCT(LEN(A:A)-LEN(SUBSTITUTE(A:A,"@",""))) en Excel da este número). */
function countAtSymbols(v: string): number {
  const s = String(v ?? "");
  let n = 0;
  for (const ch of s) if (ch === "@") n++;
  return n;
}

/**
 * Guarda un CSV en Postgres (blob_store) en lugar del filesystem local.
 * Crucial en Railway: el filesystem es efímero y se pierde en cada deploy/restart.
 */
export async function saveCSV(filename: string, buffer: Buffer): Promise<CSVMetadata> {
  const file_id = randomUUID();
  // 1. Persistir el archivo binario en blob_store
  await writeBlob(`${CSV_BLOB_PREFIX}${file_id}`, buffer, "text/csv");

  const text = buffer.toString("utf-8");
  const rows = parseCSV(text);
  const columns = rows[0] ?? [];
  const dataRows = rows.slice(1);

  const preview: Array<Record<string, string>> = [];
  for (const r of dataRows.slice(0, 3)) {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => (obj[c] = r[i] ?? ""));
    preview.push(obj);
  }

  const meta: CSVMetadata = {
    file_id,
    filename,
    columns,
    row_count: dataRows.length,
    preview,
  };

  // 2. Persistir la metadata por separado para acceso rápido
  await writeJson(`${CSV_META_PREFIX}${file_id}`, meta);

  return meta;
}

/** Guarda SOLO el blob (sin parsear). Devuelve file_id rápido para que el
 *  cliente abra el SSE de parsing con progreso por lotes. */
export async function saveCSVBlobOnly(filename: string, buffer: Buffer): Promise<{ file_id: string; size: number; filename: string }> {
  const file_id = randomUUID();
  await writeBlob(`${CSV_BLOB_PREFIX}${file_id}`, buffer, "text/csv");
  return { file_id, size: buffer.length, filename };
}

/** Cuenta líneas del CSV de manera rápida (sin parsear celdas). Sirve como
 *  total estimado para la barra de progreso. */
export async function estimateRowCount(file_id: string): Promise<number> {
  const text = await readCSVText(file_id);
  // Aproximación: número de \n menos la cabecera. Sobrestima en CSVs con
  // campos multi-línea entrecomillados, pero es suficiente para la barra.
  const newlines = (text.match(/\n/g) || []).length;
  return Math.max(0, newlines - 1);
}

/**
 * Parsea el CSV emitiendo progreso por chunks de N filas. Diseñado para SSE:
 * el caller emite cada chunk al cliente para mover la barra.
 *
 * - onChunk(loaded, totalEstimate): se llama cada `chunkSize` filas procesadas.
 * - Al final guarda metadata en csv-meta y retorna el CSVMetadata final.
 */
export async function parseCSVStreamed(
  file_id: string,
  filename: string,
  onChunk: (info: {
    loaded: number;
    totalEstimate: number;
    emails: number;
    rowsWithEmail: number;
    atSymbols: number;
    parseMode?: string;
    errors?: number;
  }) => Promise<void> | void,
  chunkSize = 100,
): Promise<CSVMetadata> {
  const totalEstimate = await estimateRowCount(file_id);
  const text = await readCSVText(file_id);

  // DETECCIÓN MANUAL del delimitador desde la primera línea — más fiable
  // que el auto-detect de Papa cuando el archivo es grande. Contamos
  // ocurrencias de cada candidato (, ; \t |) y elegimos el mayor.
  const firstNewline = text.indexOf("\n");
  const firstLine = firstNewline > 0 ? text.slice(0, firstNewline) : text.slice(0, 500);
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semiCount = (firstLine.match(/;/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const pipeCount = (firstLine.match(/\|/g) || []).length;
  let delimiter = ",";
  let maxCount = commaCount;
  if (semiCount > maxCount) { delimiter = ";"; maxCount = semiCount; }
  if (tabCount  > maxCount) { delimiter = "\t"; maxCount = tabCount; }
  if (pipeCount > maxCount) { delimiter = "|"; maxCount = pipeCount; }
  const delimLabel = delimiter === "\t" ? "TAB" : delimiter === " " ? "SPC" : delimiter;

  // Hacemos las DOS pasadas y reportamos cuál ganó para diagnóstico.
  let parseMode = `estricto · delim=${delimLabel}`;
  let parseErrors = 0;
  const passA = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    delimiter, // FORZADO en vez de "" auto-detect
    quoteChar: '"',
    escapeChar: '"',
  });
  const rowsA = (passA.data || []).filter((r) => r && r.length > 0);
  const hasQuoteErrors = (passA.errors || []).some((e) => e.code === "MissingQuotes" || e.type === "Quotes");
  parseErrors = (passA.errors || []).length;
  let allRows = rowsA;
  if (hasQuoteErrors) {
    const passB = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: "greedy",
      delimiter,
      quoteChar: String.fromCharCode(1),
    });
    const rowsB = (passB.data || []).filter((r) => r && r.length > 0);
    if (rowsB.length > rowsA.length * 1.5) {
      allRows = rowsB;
      parseMode = `rescate-sin-quoting · delim=${delimLabel}`;
    } else {
      parseMode = `estricto · delim=${delimLabel} · ${parseErrors} warnings`;
    }
  }
  console.log(`[csv parse] file=${filename} delim=${delimLabel} mode=${parseMode} rowsA=${rowsA.length} dataRows=${allRows.length - 1}`);
  const columns = allRows[0] ?? [];
  const dataRows = allRows.slice(1);

  // Detectar columnas email con umbral PERMISIVO (≥30%) y muestra MÁS GRANDE
  // (hasta 500 filas), para no perder columnas con muchos huecos.
  const sampleSize = Math.min(dataRows.length, 500);
  const emailColIdx: number[] = [];
  if (sampleSize > 0) {
    for (let c = 0; c < columns.length; c++) {
      let hits = 0;
      let nonEmpty = 0;
      for (let r = 0; r < sampleSize; r++) {
        const v = String(dataRows[r][c] ?? "").trim();
        if (v) nonEmpty++;
        if (isEmail(v)) hits++;
      }
      // Si la columna tiene casi solo emails (≥30% de las no-vacías),
      // la consideramos columna email.
      if (nonEmpty > 0 && hits >= nonEmpty * 0.3) emailColIdx.push(c);
    }
  }

  // Conteo SIEMPRE sobre TODAS las celdas de cada fila (no solo las columnas
  // email detectadas) — así no perdemos ningún email aunque esté en una
  // columna inesperada (notas, descripción, etc.).
  let loaded = 0;
  let totalEmails = 0;
  let rowsWithEmail = 0;
  let totalAtSymbols = 0;
  // Desglose por columna (índice → contador de emails). Permite ver
  // dónde están realmente los emails — clave para diagnosticar "10K → 3K".
  const emailsByCol = new Array<number>(columns.length).fill(0);

  // Cadencia adaptativa: queremos que la animación tarde ~4-5 segundos
  // independientemente del tamaño, para que el usuario vea los contadores
  // subir de 100 en 100 en lugar de pasar de 0 a 18K en un flash.
  // Mínimo 25ms entre chunks, máximo 80ms.
  const numChunks = Math.max(1, Math.ceil(dataRows.length / chunkSize));
  const targetTotalMs = 4500;
  const delayPerChunk = Math.min(80, Math.max(25, Math.floor(targetTotalMs / numChunks)));

  for (let i = 0; i < dataRows.length; i += chunkSize) {
    const end = Math.min(dataRows.length, i + chunkSize);
    for (let r = i; r < end; r++) {
      const row = dataRows[r];
      let rowEmails = 0;
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        const n = countEmailsInCell(cell);
        rowEmails += n;
        if (n > 0 && c < emailsByCol.length) emailsByCol[c] += n;
        totalAtSymbols += countAtSymbols(cell);
      }
      totalEmails += rowEmails;
      if (rowEmails > 0) rowsWithEmail++;
    }
    loaded = end;
    await onChunk({
      loaded,
      totalEstimate: Math.max(totalEstimate, dataRows.length),
      emails: totalEmails,
      rowsWithEmail,
      atSymbols: totalAtSymbols,
      parseMode,
      errors: parseErrors,
    });
    // Delay real para que la animación se vea — no solo setImmediate.
    await new Promise((res) => setTimeout(res, delayPerChunk));
  }

  const preview: Array<Record<string, string>> = [];
  for (const r of dataRows.slice(0, 3)) {
    const obj: Record<string, string> = {};
    columns.forEach((c, i) => (obj[c] = r[i] ?? ""));
    preview.push(obj);
  }

  const meta: CSVMetadata = {
    file_id,
    filename,
    columns,
    row_count: dataRows.length,
    email_columns: emailColIdx.map((i) => columns[i]).filter(Boolean),
    email_count: totalEmails,
    rows_with_email: rowsWithEmail,
    at_symbols: totalAtSymbols,
    emails_by_column: emailsByCol
      .map((count, i) => ({ column: columns[i] || `(col ${i})`, count }))
      .filter((e) => e.count > 0)
      .sort((a, b) => b.count - a.count),
    parse_mode: parseMode,
    preview,
  };
  await writeJson(`${CSV_META_PREFIX}${file_id}`, meta);
  return meta;
}

async function readCSVText(file_id: string): Promise<string> {
  const blob = await readBlob(`${CSV_BLOB_PREFIX}${file_id}`);
  if (!blob) {
    throw new Error(
      `file_id ${file_id} no encontrado. Si subiste el CSV antes de un redeploy, vuélvelo a subir.`
    );
  }
  return blob.data.toString("utf-8");
}

export async function getCSVMetadata(file_id: string): Promise<CSVMetadata | null> {
  return await readJson<CSVMetadata>(`${CSV_META_PREFIX}${file_id}`);
}

export async function readCSVAsLeads(
  file_id: string,
  mapping: {
    email: string;
    first_name?: string;
    last_name?: string;
    company_name?: string;
    custom_variables?: Record<string, string>;
  }
): Promise<Array<Record<string, any>>> {
  const text = await readCSVText(file_id);
  const rows = parseCSV(text);
  const columns = rows[0];
  const dataRows = rows.slice(1);
  const idx = (col: string | undefined) => (col ? columns.indexOf(col) : -1);

  const emailIdx = idx(mapping.email);
  if (emailIdx === -1) {
    throw new Error(
      `Columna email '${mapping.email}' no existe. Columnas disponibles: ${columns.join(", ")}`
    );
  }

  const firstIdx = idx(mapping.first_name);
  const lastIdx = idx(mapping.last_name);
  const companyIdx = idx(mapping.company_name);
  const customIdx: Record<string, number> = {};
  if (mapping.custom_variables) {
    for (const [k, v] of Object.entries(mapping.custom_variables)) {
      customIdx[k] = columns.indexOf(v);
    }
  }

  const leads: Array<Record<string, any>> = [];
  for (const row of dataRows) {
    const email = (row[emailIdx] ?? "").trim();
    if (!email || !email.includes("@")) continue;
    const lead: Record<string, any> = { email };
    if (firstIdx >= 0) lead.first_name = (row[firstIdx] ?? "").trim();
    if (lastIdx >= 0) lead.last_name = (row[lastIdx] ?? "").trim();
    if (companyIdx >= 0) lead.company_name = (row[companyIdx] ?? "").trim();
    const customVars: Record<string, string> = {};
    let hasCustom = false;
    for (const [k, i] of Object.entries(customIdx)) {
      if (i >= 0) {
        customVars[k] = (row[i] ?? "").trim();
        hasCustom = true;
      }
    }
    if (hasCustom) lead.custom_variables = customVars;
    leads.push(lead);
  }
  return leads;
}

// ===== Email accounts =====

export type AccountColumnMapping = {
  email: string;
  smtp_host: string;
  smtp_port: string;
  smtp_username?: string;
  smtp_password: string;
  imap_host: string;
  imap_port: string;
  imap_username?: string;
  imap_password: string;
  first_name?: string;
  last_name?: string;
  daily_limit?: string;
  warmup_limit?: string;
};

export async function readCSVAsAccounts(
  file_id: string,
  mapping: AccountColumnMapping
): Promise<Array<Record<string, any>>> {
  const text = await readCSVText(file_id);
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const columns = rows[0];
  const dataRows = rows.slice(1);
  const idx = (col: string | undefined) => (col ? columns.indexOf(col) : -1);

  const required = [
    "email",
    "smtp_host",
    "smtp_port",
    "smtp_password",
    "imap_host",
    "imap_port",
    "imap_password",
  ] as const;
  for (const k of required) {
    const colName = (mapping as any)[k];
    if (!colName) throw new Error(`Falta mapping para campo requerido: ${k}`);
    if (columns.indexOf(colName) === -1)
      throw new Error(`Columna '${colName}' (${k}) no existe en el CSV. Disponibles: ${columns.join(", ")}`);
  }

  const out: Array<Record<string, any>> = [];
  for (const row of dataRows) {
    const email = (row[idx(mapping.email)] ?? "").trim();
    if (!email || !email.includes("@")) continue;
    out.push({
      email,
      first_name: (row[idx(mapping.first_name)] ?? "").trim(),
      last_name: (row[idx(mapping.last_name)] ?? "").trim(),
      smtp_host: (row[idx(mapping.smtp_host)] ?? "").trim(),
      smtp_port: parseInt(row[idx(mapping.smtp_port)] ?? "587", 10),
      smtp_username: (row[idx(mapping.smtp_username)] ?? "").trim() || email,
      smtp_password: row[idx(mapping.smtp_password)] ?? "",
      imap_host: (row[idx(mapping.imap_host)] ?? "").trim(),
      imap_port: parseInt(row[idx(mapping.imap_port)] ?? "993", 10),
      imap_username: (row[idx(mapping.imap_username)] ?? "").trim() || email,
      imap_password: row[idx(mapping.imap_password)] ?? "",
      daily_limit: mapping.daily_limit ? parseInt(row[idx(mapping.daily_limit)] ?? "30", 10) : 30,
      warmup_limit: mapping.warmup_limit ? parseInt(row[idx(mapping.warmup_limit)] ?? "30", 10) : 30,
    });
  }
  return out;
}

/**
 * Parser CSV usando Papa Parse con DOBLE pasada y auto-recuperación.
 *
 * - Pasada A: con comillas activas. Maneja correctamente campos con saltos
 *   de línea internos legítimamente entrecomillados (descripciones largas).
 * - Pasada B (fallback): con quoteChar inexistente. Cada \n es fin de fila.
 *   Maneja CSVs mal formados con comillas sin cerrar que normalmente harían
 *   que el parser se trague miles de filas.
 *
 * Heurística: si A tiene errores de comillas Y B saca MUCHAS más filas
 * (más del 50%), el archivo está malformado y usamos B. En caso contrario,
 * A es correcto (es CSV bien formado con campos multi-línea).
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

  // Si no hay errores de comillas → pasada A es fiable.
  if (!hasQuoteErrors) return rowsA;

  // Hay errores de comillas. Probamos B con quoting deshabilitado y comparamos.
  const passB = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    delimiter: "",
    quoteChar: String.fromCharCode(1), // SOH: nunca aparece en CSV real → quoting OFF
  });
  const rowsB = (passB.data || []).filter((r) => r && r.length > 0);

  // Si B saca significativamente más filas, A se trago contenido por comilla
  // mal cerrada → usamos B (aunque rompa algun multi-line legítimo, prevalece
  // no perder leads enteros).
  if (rowsB.length > rowsA.length * 1.5) {
    console.warn(`[csv] comillas malformadas detectadas; fallback sin quoting (${rowsA.length} → ${rowsB.length} filas)`);
    return rowsB;
  }
  return rowsA;
}

