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
  /** Firma HTML que se añade automáticamente al final de cada email enviado
   *  desde esta cuenta. Puede incluir nombre, cargo, web, redes, logo. */
  signature_html?: string | null;
  /** UID máximo visto en INBOX — para sync incremental (sólo bajar nuevos). */
  last_uid_inbox?: number | null;
  /** UID máximo visto en Sent — para sync incremental. */
  last_uid_sent?: number | null;
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

/** Borra TODOS los mensajes de una unibox (de todas sus cuentas).
 *  El próximo sync los volverá a traer desde IMAP. */
export async function clearAllMessages(uniboxId: string): Promise<{ accounts: number; deleted: number }> {
  const msgs = await loadMessagesMap(uniboxId);
  let total = 0;
  let accountsTouched = 0;
  for (const acctId of Object.keys(msgs)) {
    if (msgs[acctId]?.length) {
      total += msgs[acctId].length;
      accountsTouched++;
    }
  }
  await saveMessagesMap(uniboxId, {});
  return { accounts: accountsTouched, deleted: total };
}

/** Detecta si un mensaje es un bounce / failure / delivery report.
 *  Devuelve true para mensajes auto-generados de "no entregable" que NO
 *  queremos mostrar en la bandeja del cliente. */
export function isBounceOrFailure(m: { from?: string; fromAddress?: string; fromName?: string; subject?: string; text?: string }): boolean {
  const from = (m.fromAddress || m.from || "").toLowerCase();
  const fromName = (m.fromName || "").toLowerCase();
  const subject = (m.subject || "").toLowerCase();
  const text = (m.text || "").slice(0, 2000).toLowerCase();

  // CAPA 1 — direcciones INEQUÍVOCAMENTE de bounce (sistemas SMTP de aviso).
  // Estos remitentes SÓLO se usan para reportar errores de entrega: nunca un
  // humano ni un sistema legítimo de notificación los usa.
  if (
    /^(mailer-?daemon|postmaster)@/i.test(from) ||
    /^(mailer-?daemon|postmaster)$/i.test(from) ||
    /<\s*(mailer-?daemon|postmaster)@/i.test(from) ||
    /mailer-?daemon|postmaster/i.test(fromName)
  ) {
    return true;
  }

  // CAPA 2 — bounce@/delivery@/abuse@ COMO LOCAL PART (no como substring).
  // Antes el regex /bounce/ matcheaba "rebound@x.com", "bounceback.io", etc.
  if (
    /^(bounce|bounces|delivery|deliverability|abuse|failure-notice|mailer)@/i.test(from)
  ) {
    return true;
  }

  // CAPA 2-bis — NOTIFICACIONES de servicios externos (Calendly, IONOS, etc.)
  // que el usuario no quiere ver en la bandeja. Son mails legítimos pero
  // automáticos: confirmaciones, recordatorios, avisos del sistema.
  if (
    /@calendly\.com$/i.test(from) ||
    /^(no-?reply|notifications?|noreply)@calendly\.com$/i.test(from)
  ) {
    return true;
  }
  // IONOS: filtramos sus emails SISTEMA (newsletter, notificaciones, billing)
  // pero NO los emails personales enviados POR USUARIOS A TRAVÉS de IONOS.
  // Los mails del sistema vienen de @ionos.com, no de @ionos.es (hostings).
  if (
    /^(no-?reply|noreply|notification|notifications|info|servicio|service|sistema|system|billing|admin)@ionos\.(com|es|de|fr|co\.uk)$/i.test(from) ||
    /^@?ionos\.(com|de)$/i.test(from) ||
    /<\s*(no-?reply|noreply|notification|billing)@ionos\./i.test(from)
  ) {
    return true;
  }

  // CAPA 3 — noreply/no-reply NO descarta por si solo: muchas notificaciones
  // legítimas (TCX, GitHub, Calendly, demos confirmadas, etc.) usan noreply@.
  // SOLO descartamos si ADEMÁS el subject coincide con un patrón de bounce.
  const subjectIsBounce =
    /^(undelivered|undeliverable|failure notice|delivery (status notification|failure|incomplete)|mail delivery (failed|failure)|returned mail|message not delivered|no se ha podido entregar|no entregado|devuelto|fallo de entrega)/i.test(subject) ||
    /delivery has failed/i.test(subject);

  if (subjectIsBounce) return true;

  // CAPA 4 ELIMINADA: "automatic reply / out of office / autorespuesta" SON
  // respuestas legítimas que el usuario quiere ver. Antes se descartaban
  // como ruido pero realmente son señales valiosas (saber que el prospect
  // está fuera hasta X fecha es info útil para timing del follow-up).

  // CAPA 5 — emails de chequeo de estado de cuenta de Instantly / Smartlead /
  // Lemlist (test emails que no van a un cliente real).
  if (
    /test\s*email.*(check|verify|confirm).*account\s*status/i.test(subject) ||
    /test\s*email.*account\s*status/i.test(subject) ||
    /account\s*status.*test\s*email/i.test(subject) ||
    /^test\s*email\b.*\bstatus\b/i.test(subject)
  ) {
    return true;
  }

  // CAPA 6 — SPAM EVIDENTE (Viagra, lotería, herencias nigerianas, etc.):
  // patrones tan específicos que casi nunca aparecen en cold outreach legítimo.
  // SOLO con AMBOS subject + body indicador, para no caer en falsos positivos.
  const subjectSpamIndicators = [
    /\bviagra|cialis|levitra\b/i,
    /\b(you|usted)\s+(have|ha)\s+(won|ganado)\b/i,
    /lottery|lotería|jackpot|sweepstake/i,
    /nigerian?\s+prince/i,
    /inheritance|herencia\s+de/i,
    /\$\s*\d+[\,\.]\d{3}[\,\.]\d{3}/i, // grandes cantidades $X.XXX.XXX
    /\bcrypto\s+(giveaway|airdrop|profit)/i,
    /(?:click\s+here|haz\s+clic\s+aquí)\s+(now|ahora|immediately|inmediatamente)/i,
  ];
  const subjectHitsSpam = subjectSpamIndicators.some((re) => re.test(subject));
  if (subjectHitsSpam) {
    const bodySpamIndicators = /\b(claim\s+(now|today)|reclamar?\s+ahora|wire\s+transfer|western\s+union|bitcoin\s+wallet|send\s+\$?\d{4,}|tx\s+id|moneygram)\b/i;
    if (bodySpamIndicators.test(text)) return true;
  }

  // CAPA 6 — contenido: bounce sólo si el TEXTO tiene 2+ indicadores claros,
  // o 1+ Y el subject es de bounce (ya cubierto arriba). Aplicamos solo
  // cuando hay matches MÚLTIPLES porque palabras sueltas como "failure"
  // aparecen en muchos correos legítimos.
  const indicators = [
    "address not found",
    "user unknown",
    "user does not exist",
    "no such user",
    "mailbox unavailable",
    "mailbox is full",
    "mailbox full",
    "550 5.1.1",
    "550-5.1.1",
    "552 5.2.2",
    "554 5.4.6",
    "permanent error",
    "permanently rejected",
    "domain not found",
    "no encontramos a esta dirección",
    "destinatario desconocido",
    "el correo no existe",
  ];
  let matches = 0;
  for (const ind of indicators) {
    if (text.includes(ind)) matches++;
  }
  // Bound estricto: 2+ indicadores claros del cuerpo. Antes uno sólo bastaba
  // si el subject decía "delivery" (palabra demasiado común).
  if (matches >= 2) return true;
  return false;
}

/** Borra todos los bounces / fallos de entrega del histórico actual. Devuelve cuántos eliminó. */
export async function purgeBounces(uniboxId: string): Promise<{ removed: number; kept: number }> {
  const msgs = await loadMessagesMap(uniboxId);
  let removed = 0;
  let kept = 0;
  for (const acctId of Object.keys(msgs)) {
    const before = msgs[acctId].length;
    msgs[acctId] = msgs[acctId].filter((m) => !isBounceOrFailure(m));
    const diff = before - msgs[acctId].length;
    removed += diff;
    kept += msgs[acctId].length;
  }
  await saveMessagesMap(uniboxId, msgs);
  return { removed, kept };
}
