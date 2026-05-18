/**
 * Biblioteca de prompts guardados para reutilizar en /personalizacion.
 */
import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "saved-prompts";

export type SavedPrompt = {
  id: string;
  name: string;
  content: string;
  description?: string;
  provider?: "claude" | "deepseek";
  /** Etiquetas libres para organizar (sector, tipo de mensaje, etc.) */
  tags?: string[];
  /** Veces que se ha usado — para ordenar por uso reciente */
  uses?: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
};

export async function listSavedPrompts(): Promise<SavedPrompt[]> {
  return (await readJson<SavedPrompt[]>(KEY)) ?? [];
}

async function saveAll(items: SavedPrompt[]) {
  await writeJson(KEY, items);
}

export async function createSavedPrompt(input: Partial<SavedPrompt> & { name: string; content: string }): Promise<SavedPrompt> {
  const items = await listSavedPrompts();
  const now = new Date().toISOString();
  const item: SavedPrompt = {
    id: randomUUID(),
    name: input.name.trim(),
    content: input.content,
    description: input.description?.trim() || undefined,
    provider: input.provider,
    tags: input.tags ?? [],
    uses: 0,
    created_at: now,
    updated_at: now,
  };
  items.unshift(item);
  await saveAll(items);
  return item;
}

export async function updateSavedPrompt(id: string, patch: Partial<SavedPrompt>): Promise<SavedPrompt | null> {
  const items = await listSavedPrompts();
  const idx = items.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  items[idx] = {
    ...items[idx],
    ...patch,
    id: items[idx].id,
    created_at: items[idx].created_at,
    updated_at: new Date().toISOString(),
  };
  await saveAll(items);
  return items[idx];
}

export async function deleteSavedPrompt(id: string): Promise<void> {
  const items = await listSavedPrompts();
  await saveAll(items.filter((p) => p.id !== id));
}

/** Incrementa el contador de usos al cargar un prompt */
export async function markPromptUsed(id: string): Promise<void> {
  const items = await listSavedPrompts();
  const p = items.find((x) => x.id === id);
  if (!p) return;
  p.uses = (p.uses ?? 0) + 1;
  p.last_used_at = new Date().toISOString();
  await saveAll(items);
}
