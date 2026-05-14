import { randomUUID } from "crypto";
import { readBlob, writeBlob, readJson, writeJson } from "./storage";

const CSV_BLOB_PREFIX = "csv/";
const CSV_META_PREFIX = "csv-meta/";

export type CSVMetadata = {
  file_id: string;
  filename: string;
  columns: string[];
  row_count: number;
  preview: Array<Record<string, string>>;
};

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

// Minimal RFC 4180 CSV parser (handles quoted fields, embedded newlines, "")
function parseCSV(text: string): string[][] {
  // Detectar BOM y eliminarlo
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  // Detectar delimitador: si la primera línea tiene más punto-y-comas que comas, usar ;
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
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delim) {
      cur.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  // Filtrar filas vacías al final del archivo
  while (rows.length > 0 && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
  return rows;
}
