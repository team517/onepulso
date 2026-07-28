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

/** Busca el primer valor numérico de cualquiera de `keys` en el objeto,
 *  incluso si está ANIDADO (la API de Smartlead a veces envuelve los totales
 *  en subobjetos). Prioriza claves del nivel más externo. */
function deepFind(obj: any, keys: string[]): number {
  const want = new Set(keys.map((k) => k.toLowerCase()));
  const queue: any[] = [obj];
  while (queue.length) {
    const o = queue.shift();
    if (o == null || typeof o !== "object") continue;
    if (Array.isArray(o)) { for (const x of o) queue.push(x); continue; }
    for (const [k, v] of Object.entries(o)) {
      if (want.has(k.toLowerCase()) && v != null && v !== "" && Number.isFinite(Number(v))) return Number(v);
    }
    for (const v of Object.values(o)) if (v && typeof v === "object") queue.push(v);
  }
  return 0;
}

/** Analíticas de una campaña, normalizadas a números clave (tolerante a nombres y anidamiento). */
export async function getCampaignAnalytics(campaignId: string | number): Promise<CampaignStats> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) throw new Error("Falta la API key de Smartlead.");
  const raw = await slGet(`/campaigns/${campaignId}/analytics`, api_key);
  const d = raw?.data ?? raw ?? {};
  return {
    sent: deepFind(d, ["sent_count", "sent", "emails_sent", "total_sent", "sent_emails"]),
    opens: deepFind(d, ["unique_open_count", "open_count", "opens", "opened_count", "unique_opened", "unique_opens"]),
    replies: deepFind(d, ["reply_count", "replies", "replied_count", "total_replies", "unique_reply_count"]),
    bounces: deepFind(d, ["bounce_count", "bounces", "bounced_count", "hard_bounce_count"]),
    clicks: deepFind(d, ["unique_click_count", "click_count", "clicks"]),
    total: deepFind(d, ["total_count", "campaign_lead_count", "lead_count", "total_leads", "leads_count"]),
  };
}

/** Devuelve la respuesta CRUDA de analíticas de una campaña (para diagnóstico:
 *  si los números salen 0, esto muestra qué campos usa realmente Smartlead). */
export async function getCampaignAnalyticsRaw(campaignId: string | number): Promise<any> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) throw new Error("Falta la API key de Smartlead.");
  return slGet(`/campaigns/${campaignId}/analytics`, api_key);
}

// ─────────────────────────────────────────────────────────────────────────────
// Contexto para la IA: RESPUESTAS reales de los leads en Smartlead
// ─────────────────────────────────────────────────────────────────────────────

/** Quita HTML/citas y comprime espacios de un cuerpo de email. */
function cleanBody(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/^\s*>.*$/gm, " ")          // líneas citadas
    .replace(/\s+/g, " ")
    .trim();
}

/** ¿Este lead parece haber RESPONDIDO? (tolerante a nombres de campo/anidamiento) */
function looksReplied(lead: any): boolean {
  const queue: any[] = [lead];
  while (queue.length) {
    const o = queue.shift();
    if (o == null || typeof o !== "object") continue;
    if (Array.isArray(o)) { for (const x of o) queue.push(x); continue; }
    for (const [k, v] of Object.entries(o)) {
      const key = k.toLowerCase();
      if (/repl/.test(key)) {
        if (typeof v === "string" && v.trim() && v !== "0") return true;   // reply_time, last_reply_time…
        if (typeof v === "number" && v > 0) return true;                    // reply_count…
        if (v === true) return true;                                        // is_replied…
      }
      if (/(category|status|sub_?status|sentiment)/.test(key) && typeof v === "string" && /repl|interest|meeting|positive/i.test(v)) return true;
      if (v && typeof v === "object") queue.push(v);
    }
  }
  return false;
}

/** Extrae el array de mensajes del historial (tolerante a la forma de la respuesta). */
function collectHistory(hist: any): any[] {
  const cand = hist?.history ?? hist?.data ?? hist?.messages ?? hist;
  if (Array.isArray(cand)) return cand;
  if (cand && typeof cand === "object") {
    for (const v of Object.values(cand)) if (Array.isArray(v)) return v;
  }
  return [];
}

/**
 * Devuelve fragmentos de RESPUESTAS reales de los leads del cliente en Smartlead,
 * como contexto para la IA (nunca se citan literales). Acotado para no disparar
 * cientos de llamadas: prioriza leads que respondieron y limita el presupuesto.
 */
export async function getClientReplyContext(
  clientId: string | number,
  campaignIds?: Array<string | number>,
  maxSnippets = 6
): Promise<string> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) return "";
  let camps = await listCampaigns(clientId);
  if (campaignIds && campaignIds.length > 0) {
    const set = new Set(campaignIds.map((x) => String(x)));
    camps = camps.filter((c) => set.has(String(c.id)));
  }
  const snippets: string[] = [];
  let leadBudget = 20; // máx. historiales a abrir en total (coste acotado)
  for (const c of camps) {
    if (snippets.length >= maxSnippets || leadBudget <= 0) break;
    let leads: any[] = [];
    try {
      const data = await slGet(`/campaigns/${c.id}/leads?offset=0&limit=100`, api_key);
      const arr = Array.isArray(data) ? data : (data?.data ?? data?.leads ?? []);
      leads = Array.isArray(arr) ? arr : [];
    } catch { continue; }
    // Preferir los que parecen haber respondido; si no detectamos ninguno, no gastar presupuesto a ciegas
    const replied = leads.filter(looksReplied);
    const pool = replied.length ? replied : [];
    for (const l of pool) {
      if (snippets.length >= maxSnippets || leadBudget <= 0) break;
      const leadId = l.id ?? l.lead_id ?? l.lead?.id ?? l.lead?.lead_id ?? l.campaign_lead_map?.lead_id;
      if (!leadId) continue;
      leadBudget--;
      try {
        const hist = await slGet(`/campaigns/${c.id}/leads/${leadId}/message-history`, api_key);
        const items = collectHistory(hist);
        const reply = [...items].reverse().find((it) => /repl|receiv|inbound/i.test(String(it?.type ?? it?.email_type ?? it?.direction ?? "")));
        const body = cleanBody(reply?.email_body ?? reply?.body ?? reply?.email_message ?? reply?.message ?? "");
        if (body && body.length > 8) snippets.push(`- ${body.slice(0, 200)}`);
      } catch { /* seguir con el siguiente */ }
    }
  }
  return snippets.slice(0, maxSnippets).join("\n");
}

/** Agrega las analíticas de las campañas de un cliente.
 *  Si se pasa `campaignIds` (no vacío), SOLO esas campañas; si no, todas. */
export async function getClientAnalytics(
  clientId: string | number,
  campaignIds?: Array<string | number>
): Promise<{ stats: CampaignStats; campaigns: Array<{ name: string; stats: CampaignStats }> }> {
  let camps = await listCampaigns(clientId);
  if (campaignIds && campaignIds.length > 0) {
    const set = new Set(campaignIds.map((x) => String(x)));
    camps = camps.filter((c) => set.has(String(c.id)));
  }
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
