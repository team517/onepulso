/**
 * Onboarding clientes:
 *  - Stages globales (lista de pasos predeterminados del proceso).
 *  - Clientes con su propio login (slug + password) que ven el progreso en /o/[slug].
 *  - El admin actualiza qué stage está completado / en progreso para cada cliente.
 */
import { randomUUID, randomBytes } from "crypto";
import { readJson, writeJson } from "./storage";

const STAGES_KEY = "onboarding/stages";
const CLIENTS_KEY = "onboarding/clients";

export type Stage = {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  /** Para ordenar visualmente. Menor = antes. */
  order: number;
  created_at: string;
};

export type Client = {
  id: string;
  /** Nombre de la empresa o cliente */
  name: string;
  /** Slug para la URL pública /o/[slug] */
  slug: string;
  /** Email o usuario para login */
  username: string;
  /** Contraseña en texto claro (modelo simple, sin hash). */
  password: string;
  /** Email del cliente — sirve para enlazar con un Unibox cuyo client_email coincida. */
  email?: string;
  /** Password en plano del Unibox (sólo se guarda aquí para poder mostrársela
   *  al cliente en su portal. El Unibox la guarda hasheada por seguridad). */
  unibox_password?: string;
  /** Título del proyecto que ven los clientes (ej. "Web onepulso v2"). */
  project_title?: string;
  /** Persona de contacto (nombre) */
  contact_name?: string;
  /** Notas internas del admin (no las ve el cliente) */
  admin_notes?: string;
  /** Stages que ya están completados */
  completed_stage_ids: string[];
  /** Stage actualmente en progreso (opcional) */
  current_stage_id?: string;
  /** Mensaje que ve el cliente bajo la barra (opcional) */
  status_message?: string;
  created_at: string;
  updated_at: string;
};

/* ─────────────────────────  STAGES  ───────────────────────── */

export async function listStages(): Promise<Stage[]> {
  const all = (await readJson<Stage[]>(STAGES_KEY)) ?? [];
  return [...all].sort((a, b) => a.order - b.order);
}

async function saveStages(stages: Stage[]) {
  await writeJson(STAGES_KEY, stages);
}

export async function createStage(input: { title: string; description?: string; icon?: string }): Promise<Stage> {
  const stages = await listStages();
  const stage: Stage = {
    id: randomUUID(),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    icon: input.icon?.trim() || undefined,
    order: stages.length > 0 ? Math.max(...stages.map((s) => s.order)) + 1 : 0,
    created_at: new Date().toISOString(),
  };
  stages.push(stage);
  await saveStages(stages);
  return stage;
}

export async function updateStage(id: string, patch: Partial<Stage>): Promise<Stage | null> {
  const stages = await listStages();
  const idx = stages.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  stages[idx] = { ...stages[idx], ...patch, id: stages[idx].id, created_at: stages[idx].created_at };
  await saveStages(stages);
  return stages[idx];
}

export async function deleteStage(id: string): Promise<void> {
  const stages = await listStages();
  await saveStages(stages.filter((s) => s.id !== id));
  // Limpiar referencia en clientes
  const clients = await listClients();
  let dirty = false;
  for (const c of clients) {
    const before = c.completed_stage_ids.length;
    c.completed_stage_ids = c.completed_stage_ids.filter((sid) => sid !== id);
    if (c.completed_stage_ids.length !== before) dirty = true;
    if (c.current_stage_id === id) {
      c.current_stage_id = undefined;
      dirty = true;
    }
  }
  if (dirty) await saveClients(clients);
}

/** Reordena stages dado un array de ids en el orden deseado */
export async function reorderStages(orderedIds: string[]): Promise<Stage[]> {
  const stages = await listStages();
  const map = new Map(stages.map((s) => [s.id, s]));
  const next: Stage[] = [];
  orderedIds.forEach((id, idx) => {
    const s = map.get(id);
    if (s) {
      next.push({ ...s, order: idx });
      map.delete(id);
    }
  });
  // Cualquier stage no incluido se queda al final manteniendo su orden relativo
  let i = next.length;
  for (const s of map.values()) next.push({ ...s, order: i++ });
  await saveStages(next);
  return next;
}

/* ─────────────────────────  CLIENTS  ───────────────────────── */

export async function listClients(): Promise<Client[]> {
  return (await readJson<Client[]>(CLIENTS_KEY)) ?? [];
}

async function saveClients(clients: Client[]) {
  await writeJson(CLIENTS_KEY, clients);
}

export async function getClient(id: string): Promise<Client | null> {
  return (await listClients()).find((c) => c.id === id) ?? null;
}

export async function getClientBySlug(slug: string): Promise<Client | null> {
  const s = slug.toLowerCase().trim();
  return (await listClients()).find((c) => c.slug.toLowerCase() === s) ?? null;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50) || "cliente";
}

export function generatePassword(length = 10): string {
  // Caracteres legibles, evitar ambigüedades (0/O, 1/l/I)
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export async function createClient(input: {
  name: string;
  username?: string;
  password?: string;
  slug?: string;
  project_title?: string;
  contact_name?: string;
  admin_notes?: string;
  email?: string;
}): Promise<Client> {
  const clients = await listClients();
  const baseSlug = slugify(input.slug || input.name);
  // Asegurar unicidad de slug
  let slug = baseSlug;
  let i = 2;
  while (clients.some((c) => c.slug === slug)) {
    slug = `${baseSlug}-${i++}`;
  }
  const now = new Date().toISOString();
  const client: Client = {
    id: randomUUID(),
    name: input.name.trim(),
    slug,
    username: (input.username || slug).trim(),
    password: input.password?.trim() || generatePassword(10),
    project_title: input.project_title?.trim() || undefined,
    contact_name: input.contact_name?.trim() || undefined,
    admin_notes: input.admin_notes?.trim() || undefined,
    email: input.email?.trim().toLowerCase() || undefined,
    completed_stage_ids: [],
    current_stage_id: undefined,
    status_message: undefined,
    created_at: now,
    updated_at: now,
  };
  clients.push(client);
  await saveClients(clients);
  return client;
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<Client | null> {
  const clients = await listClients();
  const idx = clients.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  // No permitir cambiar id ni created_at por patch
  const existing = clients[idx];
  const next: Client = {
    ...existing,
    ...patch,
    id: existing.id,
    created_at: existing.created_at,
    updated_at: new Date().toISOString(),
  };
  // Si cambia el slug, asegurar unicidad
  if (patch.slug && patch.slug !== existing.slug) {
    const base = slugify(patch.slug);
    let s = base;
    let i = 2;
    while (clients.some((c) => c.id !== id && c.slug === s)) s = `${base}-${i++}`;
    next.slug = s;
  }
  clients[idx] = next;
  await saveClients(clients);
  return next;
}

export async function deleteClient(id: string): Promise<void> {
  const clients = await listClients();
  await saveClients(clients.filter((c) => c.id !== id));
}

/** Marca un stage como completado (o lo desmarca). */
export async function setStageCompleted(clientId: string, stageId: string, completed: boolean): Promise<Client | null> {
  const client = await getClient(clientId);
  if (!client) return null;
  const set = new Set(client.completed_stage_ids);
  if (completed) set.add(stageId);
  else set.delete(stageId);
  return updateClient(clientId, { completed_stage_ids: Array.from(set) });
}

/** Calcula porcentaje de progreso (0–100). */
export function progressPercent(client: Client, stages: Stage[]): number {
  if (stages.length === 0) return 0;
  const done = client.completed_stage_ids.filter((id) => stages.some((s) => s.id === id)).length;
  // Si hay current_stage_id que no está en completed, suma medio paso para que la barra avance "en progreso"
  const inProgress = client.current_stage_id && !client.completed_stage_ids.includes(client.current_stage_id) ? 0.5 : 0;
  return Math.round(((done + inProgress) / stages.length) * 100);
}
