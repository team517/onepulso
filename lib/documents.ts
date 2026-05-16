import { randomUUID } from "crypto";
import { readJson, writeJson, writeBlob, readBlob, deleteJson } from "./storage";

const KEY_INDEX = "documents-index";
const BLOB_PREFIX = "documents/";

export type DocumentMeta = {
  id: string;
  filename: string;
  mime: string;
  size: number;
  folder?: string;          // ruta tipo "Facturas/2026" o vacío para raíz
  tags?: string[];
  client_id?: string;       // opcional, vincula a un cliente / hilo seguimientos
  client_name?: string;
  notes?: string;
  uploaded_at: string;
};

export async function listDocuments(): Promise<DocumentMeta[]> {
  return (await readJson<DocumentMeta[]>(KEY_INDEX)) ?? [];
}

async function saveIndex(docs: DocumentMeta[]) {
  await writeJson(KEY_INDEX, docs);
}

export async function createDocument(input: {
  filename: string;
  mime: string;
  buffer: Buffer;
  folder?: string;
  tags?: string[];
  client_id?: string;
  client_name?: string;
  notes?: string;
}): Promise<DocumentMeta> {
  const id = randomUUID();
  // Persistir el binario
  await writeBlob(`${BLOB_PREFIX}${id}`, input.buffer, input.mime);

  const docs = await listDocuments();
  const doc: DocumentMeta = {
    id,
    filename: input.filename,
    mime: input.mime,
    size: input.buffer.length,
    folder: input.folder?.trim() || undefined,
    tags: input.tags || [],
    client_id: input.client_id,
    client_name: input.client_name,
    notes: input.notes?.trim() || undefined,
    uploaded_at: new Date().toISOString(),
  };
  docs.push(doc);
  await saveIndex(docs);
  return doc;
}

export async function updateDocument(id: string, patch: Partial<DocumentMeta>): Promise<DocumentMeta | null> {
  const docs = await listDocuments();
  const idx = docs.findIndex((d) => d.id === id);
  if (idx === -1) return null;
  docs[idx] = {
    ...docs[idx],
    ...patch,
    id: docs[idx].id, // no permitir cambiar el id
    uploaded_at: docs[idx].uploaded_at,
  };
  await saveIndex(docs);
  return docs[idx];
}

export async function deleteDocument(id: string): Promise<void> {
  const docs = await listDocuments();
  await saveIndex(docs.filter((d) => d.id !== id));
  // Borrar el blob (best-effort)
  try {
    await deleteJson(`${BLOB_PREFIX}${id}`);
  } catch {}
}

export async function readDocument(id: string): Promise<{ meta: DocumentMeta; data: Buffer } | null> {
  const docs = await listDocuments();
  const meta = docs.find((d) => d.id === id);
  if (!meta) return null;
  const blob = await readBlob(`${BLOB_PREFIX}${id}`);
  if (!blob) return null;
  return { meta, data: blob.data };
}

/** Devuelve la lista única de carpetas existentes (deduplicadas, ordenadas). */
export async function listFolders(): Promise<string[]> {
  const docs = await listDocuments();
  const set = new Set<string>();
  for (const d of docs) {
    if (d.folder) set.add(d.folder);
  }
  return Array.from(set).sort();
}
