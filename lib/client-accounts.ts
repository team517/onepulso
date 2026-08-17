/**
 * CUENTAS CLIENTE (multi-tenant).
 *
 * El dueño (owner) crea cuentas de cliente. Cada cliente inicia sesión en la
 * misma app pero solo ve Seguimientos y Personalización, con sus datos aislados
 * (ver lib/tenant.ts). El registro NO se namespacea (es global del owner).
 */
import crypto from "crypto";
import { readJson, writeJson } from "./storage";

const INDEX_KEY = "client-accounts/index";

export type ClientAccount = {
  id: string;
  email: string;
  name?: string;
  /** sha256(salt + password) */
  password_hash: string;
  password_salt: string;
  active: boolean;
  created_at: string;
};

/** Versión sin secretos, para enviar al frontend. */
export type ClientAccountPublic = {
  id: string;
  email: string;
  name?: string;
  active: boolean;
  created_at: string;
};

function toPublic(c: ClientAccount): ClientAccountPublic {
  return { id: c.id, email: c.email, name: c.name, active: c.active, created_at: c.created_at };
}

// -------- password hashing (sha256 + salt, igual que unibox) --------
export function hashPassword(plain: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.createHash("sha256").update(s + plain).digest("hex");
  return { hash: h, salt: s };
}
export function verifyPassword(plain: string, hash: string, salt: string): boolean {
  const computed = crypto.createHash("sha256").update(salt + plain).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
  } catch {
    return false;
  }
}

async function readAll(): Promise<ClientAccount[]> {
  return (await readJson<ClientAccount[]>(INDEX_KEY)) ?? [];
}
async function writeAll(list: ClientAccount[]): Promise<void> {
  await writeJson(INDEX_KEY, list);
}

export async function listClientAccounts(): Promise<ClientAccountPublic[]> {
  const all = await readAll();
  return all
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(toPublic);
}

/** Lista de ids de clientes ACTIVOS — usado por el scheduler para iterar tenants. */
export async function listActiveClientIds(): Promise<string[]> {
  const all = await readAll();
  return all.filter((c) => c.active).map((c) => c.id);
}

export async function getClientAccount(id: string): Promise<ClientAccount | null> {
  const all = await readAll();
  return all.find((c) => c.id === id) ?? null;
}

export async function findByEmail(email: string): Promise<ClientAccount | null> {
  const e = email.trim().toLowerCase();
  const all = await readAll();
  return all.find((c) => c.email.toLowerCase() === e) ?? null;
}

export async function createClientAccount(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<{ account?: ClientAccountPublic; error?: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Email no válido" };
  if (!input.password || input.password.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres" };
  const all = await readAll();
  if (all.some((c) => c.email.toLowerCase() === email)) return { error: "Ya existe un cliente con ese email" };
  const { hash, salt } = hashPassword(input.password);
  const account: ClientAccount = {
    id: crypto.randomBytes(8).toString("hex"),
    email,
    name: input.name?.trim() || undefined,
    password_hash: hash,
    password_salt: salt,
    active: true,
    created_at: new Date().toISOString(),
  };
  all.push(account);
  await writeAll(all);
  return { account: toPublic(account) };
}

export async function setClientActive(id: string, active: boolean): Promise<boolean> {
  const all = await readAll();
  const c = all.find((x) => x.id === id);
  if (!c) return false;
  c.active = active;
  await writeAll(all);
  return true;
}

export async function setClientPassword(id: string, password: string): Promise<{ ok?: boolean; error?: string }> {
  if (!password || password.length < 6) return { error: "La contraseña debe tener al menos 6 caracteres" };
  const all = await readAll();
  const c = all.find((x) => x.id === id);
  if (!c) return { error: "Cliente no encontrado" };
  const { hash, salt } = hashPassword(password);
  c.password_hash = hash;
  c.password_salt = salt;
  await writeAll(all);
  return { ok: true };
}

export async function deleteClientAccount(id: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((c) => c.id !== id);
  if (next.length === all.length) return false;
  await writeAll(next);
  return true;
}

export async function authenticate(email: string, password: string): Promise<ClientAccount | null> {
  const c = await findByEmail(email);
  if (!c || !c.active) return null;
  if (!verifyPassword(password, c.password_hash, c.password_salt)) return null;
  return c;
}
