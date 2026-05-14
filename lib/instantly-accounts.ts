import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";
import { envVar } from "./env";

const KEY = "instantly-accounts";

export type InstantlyAccount = {
  id: string;
  title: string;
  api_key: string;
  active: boolean;
  /** TRUE = es la cuenta del propio Xavi (onepulso). Sólo UNA puede ser owner. */
  is_owner?: boolean;
  created_at: string;
  // Fecha de renovación manual (la API de Instantly no la expone)
  renews_at?: string; // ISO date — tú la pones manualmente
  plan_label?: string; // ej "Pro", "Growth" — etiqueta libre opcional
  /** Si pertenece a un cliente, podemos guardar metadatos suyos */
  client_company?: string;
  client_contact?: string;
  /** Email con el que el cliente accede a Instantly */
  instantly_email?: string;
  /** Email de contacto del cliente (para nosotros) */
  client_email?: string;
  /** Teléfono del cliente */
  client_phone?: string;
  /** Notas internas */
  notes?: string;
  // Subscripción (legacy, ya no se rellena automáticamente — se mantiene para retrocompat)
  subscription?: {
    plan?: string;
    days_remaining?: number;
    expires_at?: string;
    is_trial?: boolean;
    status?: string;
    fetched_at: string;
  };
};

export type InstantlyAccountPublic = {
  id: string;
  title: string;
  active: boolean;
  is_owner: boolean;
  created_at: string;
  api_key_masked: string;
  renews_at?: string;
  plan_label?: string;
  days_remaining?: number;
  client_company?: string;
  client_contact?: string;
  instantly_email?: string;
  client_email?: string;
  client_phone?: string;
  notes?: string;
};

const SUBSCRIPTION_TTL_MS = 30 * 60 * 1000;
const BASE = "https://api.instantly.ai/api/v2";

/** Consulta info de suscripción a Instantly. Intenta varios endpoints conocidos. */
async function fetchSubscription(apiKey: string): Promise<InstantlyAccount["subscription"] | null> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: "*/*",
    "User-Agent": "curl/8.4.0",
  };
  // Probar /account-summary y /workspaces (los endpoints comunes en v2)
  const tryEndpoints = ["/account-summary", "/workspaces", "/account", "/me"];
  for (const ep of tryEndpoints) {
    try {
      const r = await fetch(`${BASE}${ep}`, { headers });
      if (!r.ok) continue;
      const data: any = await r.json();
      // Buscar campos típicos
      const candidate =
        Array.isArray(data) ? data[0] :
        data.workspace ?? data.account ?? data;

      const plan =
        candidate.plan_name ?? candidate.plan ?? candidate.subscription_plan ?? candidate.subscription?.plan;
      const expiresStr =
        candidate.subscription_expires_at ??
        candidate.subscription_end ??
        candidate.trial_expires_at ??
        candidate.trial_ends_at ??
        candidate.current_period_end ??
        candidate.expires_at ??
        candidate.subscription?.expires_at ??
        candidate.subscription?.current_period_end;

      if (expiresStr || plan) {
        const expires = expiresStr ? new Date(expiresStr) : null;
        const daysRemaining = expires
          ? Math.max(0, Math.ceil((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
          : undefined;
        const isTrial =
          /trial/i.test(String(plan ?? "")) ||
          !!(candidate.trial_ends_at || candidate.trial_expires_at) ||
          candidate.is_trial === true;
        return {
          plan: plan ? String(plan) : undefined,
          expires_at: expires?.toISOString(),
          days_remaining: daysRemaining,
          is_trial: isTrial,
          status: candidate.status ?? candidate.subscription_status,
          fetched_at: new Date().toISOString(),
        };
      }
    } catch {}
  }
  // Si nada funciona, marcamos al menos que la key es válida (key responde 200 en otro endpoint)
  try {
    const r = await fetch(`${BASE}/campaigns?limit=1`, { headers });
    if (r.ok) {
      return { status: "active", fetched_at: new Date().toISOString() };
    }
  } catch {}
  return null;
}

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
  // Auto-migración: si no hay ninguna marcada is_owner, marcar la primera (compat con datos viejos)
  if (all.length > 0 && !all.some((a) => a.is_owner)) {
    all[0].is_owner = true;
    await writeAll(all);
  }
  // Orden: owner primero, luego por created_at desc
  all.sort((a, b) => {
    if (a.is_owner && !b.is_owner) return -1;
    if (!a.is_owner && b.is_owner) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  return all.map((a) => {
    let daysRemaining: number | undefined;
    if (a.renews_at) {
      const ms = new Date(a.renews_at).getTime() - Date.now();
      daysRemaining = Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
    }
    return {
      id: a.id,
      title: a.title,
      active: a.active,
      is_owner: !!a.is_owner,
      created_at: a.created_at,
      api_key_masked: mask(a.api_key),
      renews_at: a.renews_at,
      plan_label: a.plan_label,
      days_remaining: daysRemaining,
      client_company: a.client_company,
      client_contact: a.client_contact,
      instantly_email: a.instantly_email,
      client_email: a.client_email,
      client_phone: a.client_phone,
      notes: a.notes,
    };
  });
}

/** Devuelve la cuenta owner (la propia de Xavi) si existe */
export async function getOwnerAccount(): Promise<InstantlyAccount | null> {
  const all = await readAll();
  return all.find((a) => a.is_owner) ?? null;
}

/** Marca una cuenta como owner. Sólo una puede ser owner — desmarca las demás. */
export async function setOwner(id: string): Promise<void> {
  const all = await readAll();
  for (const a of all) a.is_owner = a.id === id;
  await writeAll(all);
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

export async function addAccount(input: {
  title: string;
  api_key: string;
  renews_at?: string;
  plan_label?: string;
  is_owner?: boolean;
  client_company?: string;
  client_contact?: string;
}): Promise<InstantlyAccountPublic> {
  const all = await readAll();
  const willBeOwner = !!input.is_owner;
  // Si se marca como owner, desmarcar otras
  if (willBeOwner) {
    for (const a of all) a.is_owner = false;
  }
  const account: InstantlyAccount = {
    id: randomUUID(),
    title: input.title.trim(),
    api_key: input.api_key.trim(),
    // active: si es owner Y no hay activa, se activa; si no hay ninguna cuenta, también
    active: all.length === 0 || (willBeOwner && !all.some((a) => a.active)),
    is_owner: willBeOwner,
    created_at: new Date().toISOString(),
    renews_at: input.renews_at,
    plan_label: input.plan_label?.trim() || undefined,
    client_company: input.client_company?.trim() || undefined,
    client_contact: input.client_contact?.trim() || undefined,
  };
  all.push(account);
  await writeAll(all);
  const daysRemaining = account.renews_at
    ? Math.max(0, Math.ceil((new Date(account.renews_at).getTime() - Date.now()) / 86400000))
    : undefined;
  return {
    id: account.id,
    title: account.title,
    active: account.active,
    is_owner: !!account.is_owner,
    created_at: account.created_at,
    api_key_masked: mask(account.api_key),
    renews_at: account.renews_at,
    plan_label: account.plan_label,
    days_remaining: daysRemaining,
    client_company: account.client_company,
    client_contact: account.client_contact,
  };
}

export async function updateAccountMeta(id: string, patch: {
  title?: string;
  renews_at?: string | null;
  plan_label?: string | null;
  client_company?: string | null;
  client_contact?: string | null;
  instantly_email?: string | null;
  client_email?: string | null;
  client_phone?: string | null;
  notes?: string | null;
  api_key?: string;
}): Promise<void> {
  const all = await readAll();
  const a = all.find((x) => x.id === id);
  if (!a) return;
  if (typeof patch.title === "string" && patch.title.trim()) a.title = patch.title.trim();
  if (patch.renews_at === null) delete a.renews_at;
  else if (typeof patch.renews_at === "string") a.renews_at = patch.renews_at;
  if (patch.plan_label === null) delete a.plan_label;
  else if (typeof patch.plan_label === "string") a.plan_label = patch.plan_label.trim() || undefined;
  if (patch.client_company === null) delete a.client_company;
  else if (typeof patch.client_company === "string") a.client_company = patch.client_company.trim() || undefined;
  if (patch.client_contact === null) delete a.client_contact;
  else if (typeof patch.client_contact === "string") a.client_contact = patch.client_contact.trim() || undefined;
  if (patch.instantly_email === null) delete a.instantly_email;
  else if (typeof patch.instantly_email === "string") a.instantly_email = patch.instantly_email.trim() || undefined;
  if (patch.client_email === null) delete a.client_email;
  else if (typeof patch.client_email === "string") a.client_email = patch.client_email.trim() || undefined;
  if (patch.client_phone === null) delete a.client_phone;
  else if (typeof patch.client_phone === "string") a.client_phone = patch.client_phone.trim() || undefined;
  if (patch.notes === null) delete a.notes;
  else if (typeof patch.notes === "string") a.notes = patch.notes.trim() || undefined;
  if (typeof patch.api_key === "string" && patch.api_key.trim()) a.api_key = patch.api_key.trim();
  await writeAll(all);
}

export async function deleteAccount(id: string) {
  const all = await readAll();
  const target = all.find((a) => a.id === id);
  if (target?.is_owner) {
    throw new Error("No se puede eliminar la cuenta propia (owner). Marca primero otra como tuya.");
  }
  const filtered = all.filter((a) => a.id !== id);
  // Si borramos la activa, reactivar la owner (o la primera disponible)
  if (filtered.length > 0 && !filtered.some((a) => a.active)) {
    const owner = filtered.find((a) => a.is_owner);
    if (owner) owner.active = true;
    else filtered[0].active = true;
  }
  await writeAll(filtered);
}

/** Vuelve a activar la cuenta owner. Útil para "volver a mi cuenta" tras trabajar con cliente. */
export async function activateOwner(): Promise<boolean> {
  const all = await readAll();
  const owner = all.find((a) => a.is_owner);
  if (!owner) return false;
  for (const a of all) a.active = a.id === owner.id;
  await writeAll(all);
  return true;
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
