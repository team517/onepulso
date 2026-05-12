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
  // Cache de info de suscripción (refrescada cada 30 min)
  subscription?: {
    plan?: string;
    days_remaining?: number;
    expires_at?: string;
    is_trial?: boolean;
    status?: string;
    fetched_at: string;
  };
};

export type InstantlyAccountPublic = Omit<InstantlyAccount, "api_key"> & {
  api_key_masked: string;
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

export async function listAccounts(opts: { refresh?: boolean } = {}): Promise<InstantlyAccountPublic[]> {
  const all = await readAll();
  // Refrescar info de suscripción si es vieja o si se pide explícitamente
  const now = Date.now();
  let mutated = false;
  await Promise.all(
    all.map(async (a) => {
      const stale =
        !a.subscription ||
        now - new Date(a.subscription.fetched_at).getTime() > SUBSCRIPTION_TTL_MS;
      if (stale || opts.refresh) {
        const sub = await fetchSubscription(a.api_key);
        if (sub) {
          a.subscription = sub;
          mutated = true;
        }
      }
    })
  );
  if (mutated) await writeAll(all);

  return all.map((a) => ({
    id: a.id,
    title: a.title,
    active: a.active,
    created_at: a.created_at,
    api_key_masked: mask(a.api_key),
    subscription: a.subscription,
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
