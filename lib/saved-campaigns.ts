/**
 * "Campañas guardadas" en el módulo de Personalización.
 * Es una combinación de: CSV de leads + mapping de columnas + prompt + modelo.
 * Permite volver a una configuración exacta sin volver a subir leads.
 *
 * El CSV físico ya está persistido en blob_store (csv/{file_id}) por saveCSV().
 * Aquí solo guardamos la METADATA + referencia al file_id.
 */
import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "saved-personalization-campaigns";

export type SavedCampaign = {
  id: string;
  name: string;
  description?: string;
  /** file_id en el blob_store (csv/{file_id}) */
  file_id: string;
  filename: string;
  total_rows: number;
  columns: string[];
  mapping: Record<string, string | undefined>;
  prompt: string;
  provider: "claude" | "deepseek";
  /** Estadística — cuántas veces se ha cargado esta campaña */
  uses?: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
};

export async function listSavedCampaigns(): Promise<SavedCampaign[]> {
  return (await readJson<SavedCampaign[]>(KEY)) ?? [];
}

async function saveAll(items: SavedCampaign[]) {
  await writeJson(KEY, items);
}

export async function getSavedCampaign(id: string): Promise<SavedCampaign | null> {
  const all = await listSavedCampaigns();
  return all.find((c) => c.id === id) ?? null;
}

export async function createSavedCampaign(input: Omit<SavedCampaign, "id" | "created_at" | "updated_at" | "uses">): Promise<SavedCampaign> {
  const items = await listSavedCampaigns();
  const now = new Date().toISOString();
  const item: SavedCampaign = {
    ...input,
    id: randomUUID(),
    uses: 0,
    created_at: now,
    updated_at: now,
  };
  items.unshift(item);
  await saveAll(items);
  return item;
}

export async function updateSavedCampaign(id: string, patch: Partial<SavedCampaign>): Promise<SavedCampaign | null> {
  const items = await listSavedCampaigns();
  const idx = items.findIndex((c) => c.id === id);
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

export async function deleteSavedCampaign(id: string): Promise<void> {
  const items = await listSavedCampaigns();
  await saveAll(items.filter((c) => c.id !== id));
}

export async function markCampaignUsed(id: string): Promise<void> {
  const items = await listSavedCampaigns();
  const c = items.find((x) => x.id === id);
  if (!c) return;
  c.uses = (c.uses ?? 0) + 1;
  c.last_used_at = new Date().toISOString();
  await saveAll(items);
}
