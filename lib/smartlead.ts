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
  // Reintenta ante límites de la API (429) o errores transitorios (5xx) con
  // backoff. Con muchos clientes/campañas evita que una llamada estrangulada
  // devuelva un dato a 0 en el informe.
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt + Math.floor(Math.random() * 300)));
    let res: Response;
    try {
      res = await fetch(withKey(path, key), { headers: { Accept: "application/json" }, cache: "no-store" });
    } catch (e: any) {
      lastErr = e?.message || "network"; // fallo de red → reintentar
      continue;
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (res.ok) return json;
    lastErr = (json && (json.message || json.error)) || `HTTP ${res.status}`;
    // 429 (rate limit) y 5xx → reintentar; el resto (401/404…) → fallar ya.
    if (res.status !== 429 && res.status < 500) break;
  }
  throw new Error(`Smartlead ${lastErr}`);
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

/** Quita HTML, CSS de Office (VML), decodifica entidades, citas y comprime espacios. */
function cleanBody(html: string): string {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/[a-z]+\\?:\*\s*\{[^}]*\}/gi, " ")   // reglas VML tipo  v\:* {behavior:...}
    .replace(/\{[^}]{0,160}\}/g, " ")             // bloques css sueltos
    .replace(/<[^>]+>/g, " ")
    // decodificar entidades numéricas (hex y decimal) — p.ej. autorespuestas en japonés
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return " "; } })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/^\s*>.*$/gm, " ")          // líneas citadas
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrae la dirección de email de un campo "Nombre <a@b.com>". */
function emailAddr(s: string): string {
  const m = String(s || "").match(/[^\s<>"]+@[^\s<>"]+/);
  return m ? m[0].toLowerCase().replace(/[>,;.]+$/, "") : "";
}

/** ¿Es un rebote o una autorespuesta (fuera de oficina, buzón automático…)? Multilingüe. */
function isAutoOrBounce(from: string, body: string): boolean {
  const f = from.toLowerCase();
  if (/mailer-daemon|postmaster|no-?reply|do-?not-?reply|donotreply|mail\s*delivery|delivery\s*subsystem|bounce/.test(f)) return true;
  const b = body.toLowerCase();
  return (
    /could not be delivered|delivery (has )?failed|undeliverable|address (could not|not found|not be reached)|mail delivery failed|delivery status notification/.test(b) ||
    /no se pudo entregar|no ha sido entregado|mensaje rechazado/.test(b) ||
    /out of office|automatic reply|auto[-\s]?reply|automated (response|reply|message)|on vacation|away from|do not monitor|is not monitored/.test(b) ||
    /fuera de (la )?oficina|correo (electrónico )?autom[aá]tico|respuesta autom[aá]tica|mensaje autom[aá]tico|no recibe respuestas|de vacaciones|estar[eé] ausente|me encuentro ausente/.test(b) ||
    /自動返信|自動応答|无法投递|無法投遞|不在/.test(body)
  );
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

/** De un historial, devuelve el texto de la RESPUESTA HUMANA real (from = email del
 *  lead), excluyendo rebotes y autorespuestas. "" si no hay. */
function humanReplyFromHistory(items: any[], leadEmail: string): string {
  const le = String(leadEmail || "").toLowerCase();
  const domain = le.split("@")[1] || "";
  const replies = items.filter((i) => /repl|receiv|inbound/i.test(String(i?.type ?? i?.email_type ?? i?.direction ?? "")));
  for (const rp of [...replies].reverse()) {   // la más reciente primero
    const from = emailAddr(rp?.from ?? rp?.from_email ?? "");
    const body = cleanBody(rp?.email_body ?? rp?.body ?? rp?.email_message ?? rp?.message ?? "");
    if (!body || body.length < 10) continue;
    const fromLead = !!le && (from === le || (!!domain && from.endsWith("@" + domain)));
    if (!fromLead) continue;                    // los rebotes vienen de mailer-daemon@otro-dominio
    if (isAutoOrBounce(from, body)) continue;
    return body;
  }
  return "";
}

// Cache de categorías (id → sentiment) durante el proceso.
let _catCache: { positive: Set<number>; neutral: Set<number> } | null = null;
async function loadReplyCategories(key: string): Promise<{ positive: Set<number>; neutral: Set<number> }> {
  if (_catCache) return _catCache;
  try {
    const cats = await slGet("/leads/fetch-categories", key);
    const arr = Array.isArray(cats) ? cats : (cats?.data ?? []);
    const positive = new Set<number>(), neutral = new Set<number>();
    for (const c of arr) {
      const id = Number(c?.id);
      const s = String(c?.sentiment_type ?? "").toLowerCase();
      const name = String(c?.name ?? "").toLowerCase();
      if (!Number.isFinite(id)) continue;
      if (s === "positive") positive.add(id);
      // "Uncategorizable" = respuesta humana de sentimiento desconocido (pool neutro útil)
      else if (/uncategoriz/.test(name)) neutral.add(id);
    }
    if (positive.size || neutral.size) { _catCache = { positive, neutral }; return _catCache; }
  } catch { /* usar defaults */ }
  _catCache = { positive: new Set([1, 2, 5]), neutral: new Set([8]) };
  return _catCache;
}

/**
 * Fragmentos de RESPUESTAS HUMANAS REALES de los leads del cliente en Smartlead,
 * como contexto para la IA (nunca se citan literales; solo dan color al análisis).
 *
 * Solo considera leads con categoría POSITIVA (Interested / Meeting Request /
 * Information Request) o "Uncategorizable" — NUNCA negativas (Not Interested / Do
 * Not Contact), fuera-de-oficina, wrong-person ni rebotes. Además filtra rebotes y
 * autorespuestas a nivel de mensaje. Si no hay ninguna respuesta positiva, devuelve
 * "" y la IA redacta el análisis solo con las métricas (siempre en positivo).
 *
 * Coste acotado: solo abre el historial de leads con categoría útil, con presupuesto
 * de páginas e historiales.
 */
export async function getClientReplyContext(
  clientId: string | number,
  campaignIds?: Array<string | number>,
  maxSnippets = 5
): Promise<string> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) return "";
  let camps = await listCampaigns(clientId);
  if (campaignIds && campaignIds.length > 0) {
    const set = new Set(campaignIds.map((x) => String(x)));
    camps = camps.filter((c) => set.has(String(c.id)));
  }
  const { positive, neutral } = await loadReplyCategories(api_key);
  const wanted = new Set<number>([...positive, ...neutral]);
  if (wanted.size === 0) return "";

  const snippets: string[] = [];
  let pageBudget = 8;    // máx. páginas de leads a escanear en total (100 leads/página)
  let histBudget = 6;    // máx. historiales a abrir en total

  for (const c of camps) {
    if (snippets.length >= maxSnippets || histBudget <= 0 || pageBudget <= 0) break;
    // 1) Recolectar candidatos con categoría útil (positiva/neutra) escaneando páginas.
    const candidates: Array<{ leadId: string | number; email: string; positive: boolean }> = [];
    for (let off = 0; pageBudget > 0 && candidates.length < histBudget; off += 100) {
      pageBudget--;
      let arr: any[] = [];
      try {
        const data = await slGet(`/campaigns/${c.id}/leads?offset=${off}&limit=100`, api_key);
        arr = Array.isArray(data) ? data : (data?.data ?? data?.leads ?? []);
      } catch { break; }
      if (!Array.isArray(arr) || arr.length === 0) break;
      for (const l of arr) {
        const cat = Number(l?.lead_category_id);
        if (!Number.isFinite(cat) || !wanted.has(cat)) continue;
        const leadId = l?.lead?.id ?? l?.lead_id ?? l?.id;
        const email = l?.lead?.email ?? l?.email ?? "";
        if (leadId) candidates.push({ leadId, email, positive: positive.has(cat) });
      }
    }
    // Priorizar las categorías positivas antes que las neutras.
    candidates.sort((a, b) => Number(b.positive) - Number(a.positive));
    // 2) Abrir el historial de cada candidato y quedarse con la respuesta humana real.
    for (const cand of candidates) {
      if (snippets.length >= maxSnippets || histBudget <= 0) break;
      histBudget--;
      try {
        const hist = await slGet(`/campaigns/${c.id}/leads/${cand.leadId}/message-history`, api_key);
        const body = humanReplyFromHistory(collectHistory(hist), cand.email);
        if (body) snippets.push(`- ${body.slice(0, 220)}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Informe estilo "Últimas 48 horas": ventana por fechas + actividad diaria
// ─────────────────────────────────────────────────────────────────────────────

export type ReportCampaignRow = { name: string; contacted: number; sent: number; replies: number; interested: number };
export type ClientReportData = {
  totals: { contacted: number; sent: number; replies: number; interested: number; bounces: number; remaining: number; newContacted: number };
  replyRate: number; // 0..1
  perCampaign: ReportCampaignRow[];
  daily: Array<{ label: string; sent: number; replies: number }>;
};

function ymd(d: Date): string { return d.toISOString().slice(0, 10); }
function ddmm(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Datos para el informe estilo "Últimas 48 horas" de un cliente, con datos REALES
 * de Smartlead por rango de fechas:
 *  - ventana (últimos `windowDays` días): contactados (unique_sent), enviados,
 *    respuestas, interesados (positive_reply_count), rebotes, restantes (drafted).
 *  - actividad diaria de los últimos `dailyDays` días (enviados + respuestas/día).
 * Todas las llamadas son tolerantes a fallo (por-campaña/por-día → 0).
 */
export async function getClientReport(
  clientId: string | number,
  campaignIds?: Array<string | number>,
  opts: { windowDays?: number; dailyDays?: number; cumulative?: boolean } = {}
): Promise<ClientReportData> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) throw new Error("Falta la API key de Smartlead.");
  const windowDays = Math.max(1, opts.windowDays ?? 2);
  const dailyDays = Math.max(1, opts.dailyDays ?? 7);
  const cumulative = !!opts.cumulative; // true = estado actual acumulado (todo hasta hoy)

  let camps = await listCampaigns(clientId);
  if (campaignIds && campaignIds.length > 0) {
    const set = new Set(campaignIds.map((x) => String(x)));
    camps = camps.filter((c) => set.has(String(c.id)));
  }

  const today = new Date();
  const end = ymd(today);
  const winStart = ymd(new Date(today.getTime() - (windowDays - 1) * 86400000));

  // Por campaña. ACUMULADO: /analytics (totales de todo hasta hoy) + top-level
  // (rango amplio) para interesados. VENTANA: analytics-by-date del periodo.
  const rows = await Promise.all(camps.map(async (c) => {
    if (cumulative) {
      const [cum, top] = await Promise.all([
        slGet(`/campaigns/${c.id}/analytics`, api_key).catch(() => null),
        slGet(`/campaigns/${c.id}/top-level-analytics-by-date?start_date=2020-01-01&end_date=${end}`, api_key).catch(() => null),
      ]);
      return {
        id: c.id,
        name: c.name,
        contacted: num(cum?.unique_sent_count ?? cum?.sent_count ?? top?.sent_count),
        sent: num(cum?.sent_count ?? top?.sent_count),
        replies: num(cum?.reply_count ?? top?.reply_count),
        bounces: num(cum?.bounce_count ?? top?.bounce_count),
        interested: num(top?.positive_reply_count),
        remaining: num(cum?.drafted_count),
      };
    }
    const [byDate, top] = await Promise.all([
      slGet(`/campaigns/${c.id}/analytics-by-date?start_date=${winStart}&end_date=${end}`, api_key).catch(() => null),
      slGet(`/campaigns/${c.id}/top-level-analytics-by-date?start_date=${winStart}&end_date=${end}`, api_key).catch(() => null),
    ]);
    return {
      id: c.id,
      name: c.name,
      contacted: num(byDate?.unique_sent_count ?? byDate?.sent_count ?? top?.sent_count),
      sent: num(byDate?.sent_count ?? top?.sent_count),
      replies: num(byDate?.reply_count ?? top?.reply_count),
      bounces: num(byDate?.bounce_count ?? top?.bounce_count),
      interested: num(top?.positive_reply_count),
      remaining: num(byDate?.drafted_count),
    };
  }));

  const totals = { contacted: 0, sent: 0, replies: 0, interested: 0, bounces: 0, remaining: 0, newContacted: 0 };
  const perCampaign: ReportCampaignRow[] = [];
  for (const r of rows) {
    perCampaign.push({ name: r.name, contacted: r.contacted, sent: r.sent, replies: r.replies, interested: r.interested });
    totals.contacted += r.contacted; totals.sent += r.sent; totals.replies += r.replies;
    totals.bounces += r.bounces; totals.interested += r.interested; totals.remaining += r.remaining;
  }
  perCampaign.sort((a, b) => b.sent - a.sent);

  // Actividad diaria (últimos dailyDays), sumando las campañas más activas.
  const dayDates: Date[] = [];
  for (let i = dailyDays - 1; i >= 0; i--) dayDates.push(new Date(today.getTime() - i * 86400000));
  const dailyCampIds = [...rows].sort((a, b) => b.sent - a.sent).slice(0, 4).map((r) => r.id);
  const daily = await Promise.all(dayDates.map(async (d) => {
    const ds = ymd(d);
    let sent = 0, replies = 0;
    await Promise.all(dailyCampIds.map(async (cid) => {
      const r = await slGet(`/campaigns/${cid}/analytics-by-date?start_date=${ds}&end_date=${ds}`, api_key).catch(() => null);
      sent += num(r?.sent_count); replies += num(r?.reply_count);
    }));
    return { label: ddmm(d), sent, replies };
  }));

  // "Nuevas": en acumulado = lo enviado en los últimos 2 días; en ventana = los contactados del periodo.
  totals.newContacted = cumulative ? daily.slice(-2).reduce((s, d) => s + d.sent, 0) : totals.contacted;

  const replyRate = totals.contacted ? totals.replies / totals.contacted : 0;
  return { totals, replyRate, perCampaign, daily };
}

/** Interesados (positive_reply_count) y respuestas de un cliente en UNA fecha
 *  concreta (YYYY-MM-DD). "Interesados" incluye Interested / Meeting Request /
 *  Information Request (gente con preguntas) — todo lo positivo marcado por la IA. */
export async function getClientPositiveOnDate(
  clientId: string | number,
  campaignIds: Array<string | number> | undefined,
  dateStr: string
): Promise<{ interested: number; replies: number }> {
  const { api_key } = await getSmartleadSettings();
  if (!api_key) return { interested: 0, replies: 0 };
  let camps = await listCampaigns(clientId);
  if (campaignIds && campaignIds.length > 0) {
    const set = new Set(campaignIds.map((x) => String(x)));
    camps = camps.filter((c) => set.has(String(c.id)));
  }
  let interested = 0, replies = 0;
  await Promise.all(camps.map(async (c) => {
    const t = await slGet(`/campaigns/${c.id}/top-level-analytics-by-date?start_date=${dateStr}&end_date=${dateStr}`, api_key).catch(() => null);
    interested += num(t?.positive_reply_count);
    replies += num(t?.reply_count);
  }));
  return { interested, replies };
}
