/**
 * Unibox storage layer — multi-tenant.
 * Cada "unibox" agrupa N cuentas de correo y tiene credenciales de cliente.
 *
 * Keys en kv_store:
 *   uniboxes/index              → string[] (lista de IDs)
 *   uniboxes/{id}               → Unibox (metadatos)
 *   uniboxes/{id}/accounts      → UniboxAccount[]
 *   uniboxes/{id}/messages      → { [accountId: string]: UniboxMessage[] }
 */
import crypto from "crypto";
import { readJson, writeJson, deleteJson } from "./storage";

export type Unibox = {
  id: string;
  title: string;
  client_email: string;
  client_password: string; // sha256 hash + salt
  client_password_salt: string;
  warmup_filter: boolean;
  created_at: string;
  last_sync?: string | null;
  notes?: string;
};

export type UniboxAccount = {
  id: string;
  unibox_id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  imap_user: string;
  imap_pass: string;
  imap_host: string;
  imap_port: number;
  smtp_user: string;
  smtp_pass: string;
  smtp_host: string;
  smtp_port: number;
  daily_limit?: number | null;
  warmup_enabled?: boolean;
  warmup_limit?: number | null;
  warmup_increment?: number | null;
  last_sync?: string | null;
  last_error?: string | null;
};

export type UniboxMessage = {
  uid: number;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  from: string;
  fromName: string;
  fromAddress: string;
  to: string;
  toAddress: string;
  subject: string;
  date: string;
  preview: string;
  text: string;
  html: string;
  unread: boolean;
  is_warmup: boolean;
  attachments: { filename: string; contentType: string; size: number }[];
};

// -------- password hashing (sha256 + salt) --------
export function hashPassword(plain: string, salt?: string): { hash: string; salt: string } {
  const s = salt || crypto.randomBytes(16).toString("hex");
  const h = crypto.createHash("sha256").update(s + plain).digest("hex");
  return { hash: h, salt: s };
}
export function verifyPassword(plain: string, hash: string, salt: string): boolean {
  const computed = crypto.createHash("sha256").update(salt + plain).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

// -------- unibox index --------
export async function listUniboxIds(): Promise<string[]> {
  return (await readJson<string[]>("uniboxes/index")) || [];
}
export async function listUniboxes(): Promise<Unibox[]> {
  const ids = await listUniboxIds();
  const out: Unibox[] = [];
  for (const id of ids) {
    const u = await readJson<Unibox>(`uniboxes/${id}`);
    if (u) out.push(u);
  }
  return out;
}

// -------- create / read / delete --------
export async function createUnibox(input: {
  title: string;
  client_email: string;
  client_password: string;
  warmup_filter?: boolean;
  notes?: string;
}): Promise<Unibox> {
  const id = crypto.randomBytes(8).toString("hex");
  const { hash, salt } = hashPassword(input.client_password);
  const unibox: Unibox = {
    id,
    title: input.title.trim(),
    client_email: input.client_email.toLowerCase().trim(),
    client_password: hash,
    client_password_salt: salt,
    warmup_filter: input.warmup_filter !== false,
    created_at: new Date().toISOString(),
    last_sync: null,
    notes: input.notes,
  };
  await writeJson(`uniboxes/${id}`, unibox);
  await writeJson(`uniboxes/${id}/accounts`, []);
  await writeJson(`uniboxes/${id}/messages`, {});
  const ids = await listUniboxIds();
  if (!ids.includes(id)) {
    ids.push(id);
    await writeJson("uniboxes/index", ids);
  }
  return unibox;
}

export async function getUnibox(id: string): Promise<Unibox | null> {
  return await readJson<Unibox>(`uniboxes/${id}`);
}

export async function findUniboxByClientEmail(email: string): Promise<Unibox | null> {
  const all = await listUniboxes();
  const target = email.toLowerCase().trim();
  return all.find((u) => u.client_email === target) || null;
}

export async function updateUnibox(id: string, patch: Partial<Unibox>): Promise<Unibox | null> {
  const u = await getUnibox(id);
  if (!u) return null;
  const next = { ...u, ...patch, id: u.id };
  await writeJson(`uniboxes/${id}`, next);
  return next;
}

export async function setUniboxPassword(id: string, plain: string): Promise<boolean> {
  const u = await getUnibox(id);
  if (!u) return false;
  const { hash, salt } = hashPassword(plain);
  await writeJson(`uniboxes/${id}`, { ...u, client_password: hash, client_password_salt: salt });
  return true;
}

export async function deleteUnibox(id: string): Promise<void> {
  await deleteJson(`uniboxes/${id}`);
  await deleteJson(`uniboxes/${id}/accounts`);
  await deleteJson(`uniboxes/${id}/messages`);
  const ids = await listUniboxIds();
  await writeJson("uniboxes/index", ids.filter((x) => x !== id));
}

// -------- accounts --------
export async function listAccounts(uniboxId: string): Promise<UniboxAccount[]> {
  return (await readJson<UniboxAccount[]>(`uniboxes/${uniboxId}/accounts`)) || [];
}
export async function saveAccounts(uniboxId: string, accs: UniboxAccount[]): Promise<void> {
  await writeJson(`uniboxes/${uniboxId}/accounts`, accs);
}
export async function addAccount(uniboxId: string, a: Omit<UniboxAccount, "id" | "unibox_id">): Promise<UniboxAccount> {
  const accs = await listAccounts(uniboxId);
  const id = crypto.randomBytes(8).toString("hex");
  const newAcc: UniboxAccount = { ...a, id, unibox_id: uniboxId };
  accs.push(newAcc);
  await saveAccounts(uniboxId, accs);
  return newAcc;
}
export async function deleteAccount(uniboxId: string, accountId: string): Promise<void> {
  const accs = await listAccounts(uniboxId);
  await saveAccounts(uniboxId, accs.filter((a) => a.id !== accountId));
  const msgs = await loadMessagesMap(uniboxId);
  delete msgs[accountId];
  await saveMessagesMap(uniboxId, msgs);
}

// -------- messages --------
export async function loadMessagesMap(uniboxId: string): Promise<Record<string, UniboxMessage[]>> {
  return (await readJson<Record<string, UniboxMessage[]>>(`uniboxes/${uniboxId}/messages`)) || {};
}
export async function saveMessagesMap(uniboxId: string, m: Record<string, UniboxMessage[]>): Promise<void> {
  await writeJson(`uniboxes/${uniboxId}/messages`, m);
}
