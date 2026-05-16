import { randomUUID } from "crypto";
import { readJson, writeJson, writeBlob, readBlob, deleteJson } from "./storage";

const KEY_INDEX = "documents-index";
const KEY_FOLDERS = "documents-folders";
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

/** Carpetas declaradas explícitamente (pueden estar vacías). */
async function readExplicitFolders(): Promise<string[]> {
  return (await readJson<string[]>(KEY_FOLDERS)) ?? [];
}

async function writeExplicitFolders(folders: string[]) {
  // Normalizar: trim, sin duplicados, sin vacías, ordenadas
  const unique = Array.from(new Set(folders.map((f) => f.trim()).filter(Boolean)));
  unique.sort();
  await writeJson(KEY_FOLDERS, unique);
}

/** Devuelve TODAS las carpetas: las explícitas + las derivadas de docs (deduplicadas). */
export async function listFolders(): Promise<string[]> {
  const [docs, explicit] = await Promise.all([listDocuments(), readExplicitFolders()]);
  const set = new Set<string>(explicit);
  for (const d of docs) {
    if (d.folder) set.add(d.folder);
  }
  return Array.from(set).sort();
}

/** Crea una carpeta (solo nombre — sin archivos dentro todavía). */
export async function createFolder(name: string): Promise<string[]> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nombre de carpeta vacío");
  if (trimmed.length > 100) throw new Error("Nombre demasiado largo (máx 100 caracteres)");
  const folders = await readExplicitFolders();
  if (!folders.includes(trimmed)) folders.push(trimmed);
  await writeExplicitFolders(folders);
  return await listFolders();
}

/** Renombra una carpeta. Actualiza todos los documentos que estaban en ella. */
export async function renameFolder(oldName: string, newName: string): Promise<{ renamed_docs: number }> {
  const old = oldName.trim();
  const next = newName.trim();
  if (!next) throw new Error("Nuevo nombre vacío");
  if (old === next) return { renamed_docs: 0 };

  // Actualizar docs
  const docs = await listDocuments();
  let renamed = 0;
  for (const d of docs) {
    if (d.folder === old) {
      d.folder = next;
      renamed++;
    }
  }
  await saveIndex(docs);

  // Actualizar lista explícita
  const folders = await readExplicitFolders();
  const without = folders.filter((f) => f !== old);
  if (!without.includes(next)) without.push(next);
  await writeExplicitFolders(without);

  return { renamed_docs: renamed };
}

/** Elimina una carpeta. Si force=false y tiene docs, falla. Si force=true, mueve los docs a la raíz. */
export async function deleteFolder(name: string, opts: { force?: boolean; deleteDocs?: boolean } = {}): Promise<{ moved_to_root: number; deleted_docs: number }> {
  const target = name.trim();
  if (!target) throw new Error("Nombre vacío");

  const docs = await listDocuments();
  const inside = docs.filter((d) => d.folder === target);

  if (inside.length > 0 && !opts.force && !opts.deleteDocs) {
    throw new Error(`La carpeta tiene ${inside.length} documento(s). Usa force=true para moverlos a raíz o deleteDocs=true para borrarlos.`);
  }

  let movedToRoot = 0;
  let deletedDocs = 0;

  if (opts.deleteDocs) {
    // Borrar los documentos físicamente
    for (const d of inside) {
      try { await deleteJson(`${BLOB_PREFIX}${d.id}`); } catch {}
      deletedDocs++;
    }
    const remaining = docs.filter((d) => d.folder !== target);
    await saveIndex(remaining);
  } else {
    // Mover a raíz (folder = undefined)
    for (const d of inside) {
      d.folder = undefined;
      movedToRoot++;
    }
    await saveIndex(docs);
  }

  // Quitar de la lista explícita
  const folders = await readExplicitFolders();
  await writeExplicitFolders(folders.filter((f) => f !== target));

  return { moved_to_root: movedToRoot, deleted_docs: deletedDocs };
}
