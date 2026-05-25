/**
 * Modulo "Estudios" — pizarra infinita tipo Miro.
 *
 * Cada Estudio es un canvas con elementos absolutamente posicionados en
 * coordenadas de mundo (no pantalla). Soporta pan / zoom. Los elementos
 * pueden ser notas, texto suelto, imágenes (subidas al blob_store),
 * formas (rect/círculo) y flechas (conectores entre dos elementos).
 */
import { randomUUID } from "crypto";
import { readJson, writeJson, listKeys, deleteJson } from "./storage";

const PREFIX = "estudios/";

export type ElementBase = {
  id: string;
  x: number;
  y: number;
  z: number;
};

export type NoteElement = ElementBase & {
  type: "note";
  width: number;
  height: number;
  text: string;
  color: string; // bg color
};

export type TextElement = ElementBase & {
  type: "text";
  text: string;
  fontSize: number;
  color: string;
};

export type ImageElement = ElementBase & {
  type: "image";
  width: number;
  height: number;
  /** Key en blob_store: "estudios-img/<id>" */
  src_key: string;
};

export type ShapeElement = ElementBase & {
  type: "shape";
  shape: "rect" | "circle";
  width: number;
  height: number;
  fill: string;
  stroke: string;
};

export type ArrowElement = ElementBase & {
  type: "arrow";
  /** Punto final en coords de mundo. (x,y) del base es el inicio. */
  endX: number;
  endY: number;
  stroke: string;
  /** Conexiones opcionales a elementos. Si están, los endpoints se calculan
   *  dinámicamente desde la posición/tamaño del elemento al renderizar. */
  fromId?: string;
  toId?: string;
  fromSide?: "top" | "right" | "bottom" | "left";
  toSide?: "top" | "right" | "bottom" | "left";
};

export type Element =
  | NoteElement
  | TextElement
  | ImageElement
  | ShapeElement
  | ArrowElement;

export type Estudio = {
  id: string;
  title: string;
  elements: Element[];
  viewport: { x: number; y: number; zoom: number };
  created_at: string;
  updated_at: string;
};

export async function listEstudios(): Promise<Array<{ id: string; title: string; created_at: string; updated_at: string; element_count: number }>> {
  const keys = await listKeys(PREFIX);
  // Excluir keys que no sean directamente estudios/<id> (p. ej. carpetas internas)
  const ids = keys
    .map((k) => k.replace(PREFIX, "").replace(/\.json$/, ""))
    .filter((k) => k && !k.includes("/"));
  const out: Array<{ id: string; title: string; created_at: string; updated_at: string; element_count: number }> = [];
  for (const id of ids) {
    const e = await readJson<Estudio>(`${PREFIX}${id}`);
    if (e) {
      out.push({
        id: e.id,
        title: e.title,
        created_at: e.created_at,
        updated_at: e.updated_at,
        element_count: e.elements?.length ?? 0,
      });
    }
  }
  // Más reciente primero
  out.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return out;
}

export async function getEstudio(id: string): Promise<Estudio | null> {
  return await readJson<Estudio>(`${PREFIX}${id}`);
}

export async function createEstudio(input: { title?: string }): Promise<Estudio> {
  const now = new Date().toISOString();
  const estudio: Estudio = {
    id: randomUUID(),
    title: input.title?.trim() || "Estudio sin título",
    elements: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    created_at: now,
    updated_at: now,
  };
  await writeJson(`${PREFIX}${estudio.id}`, estudio);
  return estudio;
}

export async function updateEstudio(
  id: string,
  patch: Partial<Pick<Estudio, "title" | "elements" | "viewport">>,
): Promise<Estudio | null> {
  const existing = await getEstudio(id);
  if (!existing) return null;
  const updated: Estudio = {
    ...existing,
    ...patch,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  };
  await writeJson(`${PREFIX}${id}`, updated);
  return updated;
}

export async function deleteEstudio(id: string): Promise<void> {
  await deleteJson(`${PREFIX}${id}`);
}
