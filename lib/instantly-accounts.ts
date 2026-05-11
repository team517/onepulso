import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";
import { envVar } from "./env";

const KEY = "instantly-accounts";

export type InstantlyAccount = {
  id: string;
  title: string;
  api_key: string;
  active: boolean;
  created_at: string;
};

export type InstantlyAccountPublic = Omit<InstantlyAccount, "api_key"> & {
  api_key_masked: string;
};

async function readAll(): Promise<InstantlyAccount[]> {
  return (await readJson<InstantlyAccount[]>(KEY)) ?? [];
}

async function writeAll(accounts: InstantlyAccount[]) {
  await writeJson(KEY, accounts);
}

function mask(s: string): string {
  if (!s) return "";
  if (s.length <= 12) return "•".repeat(s.length);
  return s.slice(0, 6) + "•".repeat(s.length - 10) + s.slice(-4);
}

export async function listAccounts(): Promise<InstantlyAccountPublic[]> {
  const all = await readAll();
  return all.map((a) => ({
    id: a.id,
    title: a.title,
    active: a.active,
    created_at: a.created_at,
    api_key_masked: mask(a.api_key),
  }));
}

export async function getActiveAccount(): Promise<InstantlyAccount | null> {
  const all = await readAll();
  return all.find((a) => a.active) ?? all[0] ?? null;
}

/** Devuelve la API key actualmente activa.
 *  Prioridad: cuenta activa guardada > env INSTANTLY_API_KEY. */
export async function getActiveApiKey(): Promise<string | null> {
  const active = await getActiveAccount();
  if (active?.api_key) return active.api_key;
  return envVar("INSTANTLY_API_KEY") || null;
}

export async function addAccount(input: { title: string; api_key: string }): Promise<InstantlyAccountPublic> {
  const all = await readAll();
  const account: InstantlyAccount = {
    id: randomUUID(),
    title: input.title.trim(),
    api_key: input.api_key.trim(),
    active: all.length === 0, // primera cuenta = activa por defecto
    created_at: new Date().toISOString(),
  };
  all.push(account);
  await writeAll(all);
  return {
    id: account.id,
    title: account.title,
    active: account.active,
    created_at: account.created_at,
    api_key_masked: mask(account.api_key),
  };
}

export async function deleteAccount(id: string) {
  const all = await readAll();
  const filtered = all.filter((a) => a.id !== id);
  // Si borramos la activa, activar la primera disponible
  if (filtered.length > 0 && !filtered.some((a) => a.active)) {
    filtered[0].active = true;
  }
  await writeAll(filtered);
}

export async function setActive(id: string): Promise<void> {
  const all = await readAll();
  for (const a of all) a.active = a.id === id;
  await writeAll(all);
}

export async function renameAccount(id: string, title: string): Promise<void> {
  const all = await readAll();
  const a = all.find((x) => x.id === id);
  if (a) a.title = title.trim();
  await writeAll(all);
}
