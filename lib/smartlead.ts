/**
 * Cliente de la API de Smartlead (cold email).
 * Base: https://server.smartlead.ai/api/v1  ·  Auth: ?api_key=XXX
 *
 * La API key se guarda en kv (`smartlead-settings`), no en el código, y se
 * puede configurar desde la pantalla de Clientes.
 */
import { readJson, writeJson } from "./storage";

const BASE = "https://server.smartlead.ai/api/v1";
const SETTINGS_KEY = "smartlead-settings";

export type SmartleadSettings = { api_key?: string };

export async function getSmartleadSettings(): Promise<SmartleadSettings> {
  return (await readJson<SmartleadSettings>(SETTINGS_KEY)) ?? {};
}
export async function saveSmartleadSettings(patch: Partial<SmartleadSettings>): Promise<SmartleadSettings> {
  const cur = await getSmartleadSettings();
  const next = { ...cur, ...patch };
  if (patch.api_key === "") delete next.api_key;
  await writeJson(SETTINGS_KEY, next);
  return next;
}

function withKey(path: string, key: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE}${path}${sep}api_key=${encodeURIComponent(key)}`;
}

async function slGet(path: string, key: string): Promise<any> {
  const res = await fetch(withKey(path, key), { headers: { Accept: "application/json" }, cache: "no-store" });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    const msg = (json && (json.message || json.error)) || `HTTP ${res.status}`;
    throw new Error(`Smartlead ${res.status}: ${msg}`);
  }
  return json;
}

/** Comprueba que la API key es válida (lista clientes). */
export async function testSmartlead(key: string): Promise<{ ok: boolean; error?: string; clients?: number }> {
  try {
    const clients = await listClientsWithKey(key);
    return { ok: true, clients: clients.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

export type SmartleadClient = { id: number | string; name: string; email?: string; logo?: string | null };

function normClient(c: any): SmartleadClient {
  return {
    id: c.id ?? c.client_id ?? c.uuid ?? "",
    name: c.name || c.client_name || c.company_name || c.email || `Cliente ${c.id ?? ""}`,
    email: c.email || c.client_email || undefined,
    logo: c.logo || c.logo_url || null,
  };
}

export async function listClientsWithKey(key: string): Promise<SmartleadClient[]> {
  const data = await slGet("/client/", key);
  const arr = Array.isArray(data) ? data : (data?.data ?? data?.clients ?? []);
  return (Array.isArray(arr) ? arr : []).map(normClient);
}
export async function listClients(): Promise<SmartleadClient[]> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) throw new Error("Falta la API key de Smartlead. Conéctala en la pantalla de Clientes.");
  return listClientsWithKey(api_key);
}

export type SmartleadCampaign = { id: number | string; name: string; status?: string; client_id?: number | string | null };

function normCampaign(c: any): SmartleadCampaign {
  return {
    id: c.id ?? c.campaign_id ?? "",
    name: c.name || c.campaign_name || `Campaña ${c.id ?? ""}`,
    status: c.status || c.campaign_status || undefined,
    client_id: c.client_id ?? c.client?.id ?? null,
  };
}

/** Lista campañas; si se pasa clientId, filtra por ese cliente. */
export async function listCampaigns(clientId?: string | number): Promise<SmartleadCampaign[]> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) throw new Error("Falta la API key de Smartlead.");
  const data = await slGet("/campaigns/", api_key);
  const arr = Array.isArray(data) ? data : (data?.data ?? data?.campaigns ?? []);
  let camps = (Array.isArray(arr) ? arr : []).map(normCampaign);
  if (clientId !== undefined && clientId !== null && String(clientId) !== "") {
    camps = camps.filter((c) => String(c.client_id) === String(clientId));
  }
  return camps;
}

export type CampaignStats = { sent: number; opens: number; replies: number; bounces: number; clicks: number; total: number };

function num(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** Analíticas de una campaña, normalizadas a números clave (tolerante a nombres de campo). */
export async function getCampaignAnalytics(campaignId: string | number): Promise<CampaignStats> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) throw new Error("Falta la API key de Smartlead.");
  const raw = await slGet(`/campaigns/${campaignId}/analytics`, api_key);
  const d = raw?.data ?? raw ?? {};
  const g = (obj: any, keys: string[]) => { for (const k of keys) if (obj?.[k] != null) return num(obj[k]); return 0; };
  return {
    sent: g(d, ["sent_count", "sent", "emails_sent", "total_sent"]),
    opens: g(d, ["unique_open_count", "open_count", "opens", "opened_count", "unique_opened"]),
    replies: g(d, ["reply_count", "replies", "replied_count", "total_replies"]),
    bounces: g(d, ["bounce_count", "bounces", "bounced_count"]),
    clicks: g(d, ["click_count", "clicks", "unique_click_count"]),
    total: g(d, ["total_count", "campaign_lead_count", "lead_count", "total_leads"]),
  };
}

/** Agrega las analíticas de TODAS las campañas de un cliente. */
export async function getClientAnalytics(clientId: string | number): Promise<{ stats: CampaignStats; campaigns: Array<{ name: string; stats: CampaignStats }> }> {
  const camps = await listCampaigns(clientId);
  const perCampaign: Array<{ name: string; stats: CampaignStats }> = [];
  const total: CampaignStats = { sent: 0, opens: 0, replies: 0, bounces: 0, clicks: 0, total: 0 };
  for (const c of camps) {
    let st: CampaignStats;
    try { st = await getCampaignAnalytics(c.id); }
    catch { st = { sent: 0, opens: 0, replies: 0, bounces: 0, clicks: 0, total: 0 }; }
    perCampaign.push({ name: c.name, stats: st });
    total.sent += st.sent; total.opens += st.opens; total.replies += st.replies;
    total.bounces += st.bounces; total.clicks += st.clicks; total.total += st.total;
  }
  return { stats: total, campaigns: perCampaign };
}
