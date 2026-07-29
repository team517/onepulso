/**
 * Informes PDF por cliente (analíticas de Smartlead) + envío automático.
 *
 * Estilo "Últimas 48 horas": cabecera violeta, tarjeta hero con tasa de respuesta,
 * 6 KPIs (contactados, enviados, respuestas, interesados, rebotes, restantes),
 * resumen ejecutivo + destacados (IA), y en pág. 2 actividad diaria, detalle por
 * campaña, próximos pasos y qué mejorar (IA). Réplica del informe de OnePulso.
 *
 * Config por cliente en kv `client-report-config/{clientId}`:
 *   recipient_email, email_subject, email_body_html, pdf_intro, enabled,
 *   interval_hours (def 48), last_sent_at, client_name.
 */
import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { readJson, writeJson, deleteJson, listKeys, readBlob } from "./storage";
import { getClientReport, getClientReplyContext, getClientPositiveOnDate, listClients, type ClientReportData } from "./smartlead";
import { sendEmail } from "./email-send";
import { generateText } from "./ai-providers";

const LOGO_KEY = "report-logo";
/** Logo global de la agencia para los informes (subido por el usuario). */
export async function getReportLogo(): Promise<{ buf: Buffer; mime: string } | null> {
  try { const b = await readBlob(LOGO_KEY); return b ? { buf: b.data, mime: b.mime } : null; } catch { return null; }
}

const CFG_PREFIX = "client-report-config/";

export type ReportConfig = {
  client_id: string;
  client_name: string;
  recipient_email: string;
  email_subject: string;
  email_body_html: string;
  pdf_intro: string;
  enabled: boolean;
  interval_hours: number;
  /** Campañas incluidas en el informe. Vacío/undefined = TODAS las del cliente. */
  campaign_ids?: string[];
  /** (Obsoleto) Unibox de contexto; ahora el contexto viene de Smartlead. */
  context_unibox_id?: string;
  last_sent_at?: string | null;
  /** Última fecha (YYYY-MM-DD, hora España) en que se hizo el chequeo diario de
   *  interesados a las 18:00 (para no repetir ni reenviar el mismo día). */
  last_alert_date?: string;
  updated_at: string;
};

function defaults(clientId: string, clientName: string): ReportConfig {
  return {
    client_id: clientId,
    client_name: clientName,
    recipient_email: "",
    email_subject: `Informe de rendimiento — ${clientName}`,
    email_body_html: `<p>Hola,</p><p>Te adjunto el informe de rendimiento de tus campañas de las últimas 48 horas.</p><p>Cualquier duda, aquí estamos.</p><p>Un saludo</p>`,
    pdf_intro: "",
    enabled: false,
    interval_hours: 48,
    updated_at: new Date().toISOString(),
  };
}

export async function getReportConfig(clientId: string, clientName?: string): Promise<ReportConfig> {
  const saved = await readJson<ReportConfig>(`${CFG_PREFIX}${clientId}`);
  if (saved) return saved;
  return defaults(clientId, clientName || `Cliente ${clientId}`);
}

export async function saveReportConfig(clientId: string, patch: Partial<ReportConfig> & { client_name?: string }): Promise<ReportConfig> {
  const cur = await getReportConfig(clientId, patch.client_name);
  const next: ReportConfig = { ...cur, ...patch, client_id: clientId, updated_at: new Date().toISOString() };
  await writeJson(`${CFG_PREFIX}${clientId}`, next);
  return next;
}

export async function listReportConfigs(): Promise<ReportConfig[]> {
  const keys = await listKeys(CFG_PREFIX);
  const out: ReportConfig[] = [];
  for (const k of keys) {
    const c = await readJson<ReportConfig>(k);
    if (c) out.push(c);
  }
  return out;
}

export async function deleteReportConfig(clientId: string): Promise<void> {
  await deleteJson(`${CFG_PREFIX}${clientId}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formato / tiempo
// ─────────────────────────────────────────────────────────────────────────────
function nf(n: number): string { return Number(n || 0).toLocaleString("es-ES"); }

/** Hora actual en España (Europe/Madrid): {hour, minute, date "YYYY-MM-DD"}. */
function madridNow(): { hour: number; minute: number; date: string } {
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10) % 24; // "24" → 0
  return { hour, minute: parseInt(get("minute"), 10), date: `${get("year")}-${get("month")}-${get("day")}` };
}

/** Minuto [0..59] fijo por cliente para escalonar los envíos (no se solapan). */
function slotForClient(id: string): number {
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 60;
}

/** Reescribe un mensaje HTML con OTRAS palabras (mismo significado y tono) para
 *  que cada envío no sea idéntico. Fallback: el mensaje base tal cual. */
async function varyMessageHtml(baseHtml: string, clientName: string): Promise<string> {
  const base = (baseHtml || "").trim();
  if (!base) return base;
  try {
    const txt = await generateText({
      system: "Reescribes mensajes de email de una agencia a su cliente. Mantienes EXACTAMENTE el mismo significado, tono cercano y longitud parecida, pero con otras palabras y estructura. Devuelves solo HTML simple con etiquetas <p>. Nada más.",
      prompt: `Cliente: ${clientName}. Reescribe este mensaje con otras palabras (misma idea, mismo tono, español de España, sin añadir asunto ni firma extra, sin emojis):\n\n${base}`,
      maxTokens: 400, temperature: 0.85,
    });
    const out = (txt || "").replace(/```html?/gi, "").replace(/```/g, "").trim();
    if (out && /<p|[a-zA-ZáéíóúñÁÉÍÓÚÑ]{6,}/.test(out)) return out.includes("<p") ? out : `<p>${out}</p>`;
  } catch (e: any) {
    console.warn("[client-reports] variación de mensaje no disponible:", e?.message);
  }
  return base;
}
function ratePct(rate: number): string { return (Math.round((rate || 0) * 1000) / 10).toFixed(1) + "%"; }
function pctOf(part: number, whole: number): string { return whole ? ratePct(part / whole) : "0.0%"; }

// ─────────────────────────────────────────────────────────────────────────────
// IA: 4 secciones del informe (resumen, destacados, próximos pasos, mejoras)
// ─────────────────────────────────────────────────────────────────────────────
export type ReportSections = { summary: string; highlights: string[]; nextSteps: string[]; improvements: string[] };

function fallbackSections(clientName: string, d: ClientReportData, periodLabel: string): ReportSections {
  const t = d.totals;
  return {
    summary: `En ${periodLabel.toLowerCase()} hemos contactado a ${nf(t.contacted)} personas y enviado ${nf(t.sent)} correos, con ${nf(t.replies)} respuestas y una tasa de respuesta del ${ratePct(d.replyRate)}. Tenemos ${nf(t.remaining)} contactos restantes por delante, lo que nos da mucho recorrido para seguir optimizando y hacer crecer los resultados en los próximos envíos.`,
    highlights: [
      `Hemos contactado a ${nf(t.contacted)} personas nuevas en el periodo.`,
      `Se han enviado ${nf(t.sent)} correos, situando la tasa de respuesta en el ${ratePct(d.replyRate)}.`,
      `Tenemos ${nf(t.remaining)} contactos restantes por enviar, lo que nos permite iterar sin presión.`,
    ],
    nextSteps: [
      "Revisar el asunto y el primer email para hacerlo más directo y personalizado.",
      "Añadir una variante de mensaje con otro enfoque para testear cuál resuena mejor.",
      "Incrementar el volumen de contactados para obtener datos más significativos.",
    ],
    improvements: [
      "Optimizar el asunto para aumentar la apertura.",
      "Reescribir el primer email centrándonos en un único problema con un CTA claro.",
      "Activar un follow-up con contenido de valor para reactivar el interés.",
    ],
  };
}

/** La IA redacta las 4 secciones del informe en tono POSITIVO (estilo referencia). */
export async function generateReportSections(
  clientName: string,
  d: ClientReportData,
  periodLabel: string,
  context?: string
): Promise<ReportSections> {
  const t = d.totals;
  const camps = d.perCampaign.slice(0, 12).map((c) =>
    `- ${c.name}: ${nf(c.contacted)} contactados · ${nf(c.sent)} enviados · ${nf(c.replies)} respuestas (${pctOf(c.replies, c.contacted)}) · ${nf(c.interested)} interesados`
  ).join("\n");
  const prompt = `Cliente: ${clientName}
Periodo: ${periodLabel}

MÉTRICAS DEL PERIODO:
- Personas contactadas: ${nf(t.contacted)} (todas nuevas en el periodo)
- Correos enviados: ${nf(t.sent)}
- Respuestas: ${nf(t.replies)}
- Tasa de respuesta: ${ratePct(d.replyRate)}
- Interesados (marcados por la IA): ${nf(t.interested)}
- Rebotes: ${nf(t.bounces)}
- Contactos restantes por enviar: ${nf(t.remaining)}

POR CAMPAÑA:
${camps || "(sin campañas)"}
${context ? `\nCONTEXTO DE RESPUESTAS REALES (solo para dar color, no cites literal):\n${context}\n` : ""}
Redacta un informe para el cliente final en 4 secciones. Devuelve EXCLUSIVAMENTE un JSON válido con esta forma:
{
  "summary": "1 párrafo (5-7 frases) de resumen ejecutivo del periodo",
  "highlights": ["4-5 frases de lo más destacado"],
  "nextSteps": ["4-5 acciones concretas que vais a hacer el próximo periodo"],
  "improvements": ["4-5 mejoras concretas del email/campaña"]
}

REGLAS ESTRICTAS:
- SIEMPRE en tono POSITIVO, motivador y profesional. El cliente debe quedar contento.
- Si los números son bajos, enmárcalo como "margen de crecimiento" u "oportunidad", NUNCA como problema o fallo.
- Si estamos en época de vacaciones (julio/agosto/Navidad), menciónalo como explicación natural de resultados más flojos (estacional, no de la campaña).
- Puedes comparar con el promedio del sector (1-3% de respuesta) como referencia de recorrido.
- Los rebotes SOLO se mencionan en positivo: si son 0 o bajos, es señal de que los datos de contacto son correctos. Nunca hables de rebotes como algo malo.
- Usa los nombres reales de las campañas. Español de España. Sin markdown, sin emojis, sin títulos dentro de los textos.`;

  try {
    const txt = await generateText({
      system: "Eres un analista de cold email B2B de una agencia que redacta informes para el cliente final. Tu tono es SIEMPRE positivo, motivador y profesional. Devuelves solo JSON válido, sin texto adicional.",
      prompt, maxTokens: 1100, temperature: 0.5,
    });
    const m = (txt || "").match(/\{[\s\S]*\}/);
    if (m) {
      const j = JSON.parse(m[0]);
      const arr = (v: any): string[] => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
      const out: ReportSections = {
        summary: String(j.summary || "").trim(),
        highlights: arr(j.highlights),
        nextSteps: arr(j.nextSteps),
        improvements: arr(j.improvements),
      };
      const fb = fallbackSections(clientName, d, periodLabel);
      if (!out.summary) out.summary = fb.summary;
      if (!out.highlights.length) out.highlights = fb.highlights;
      if (!out.nextSteps.length) out.nextSteps = fb.nextSteps;
      if (!out.improvements.length) out.improvements = fb.improvements;
      return out;
    }
  } catch (e: any) {
    console.warn("[client-reports] IA no disponible:", e?.message);
  }
  return fallbackSections(clientName, d, periodLabel);
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF (réplica del informe "Últimas 48 horas")
// ─────────────────────────────────────────────────────────────────────────────
type Align = "left" | "center" | "right" | "justify";

export async function generateReportPDF(opts: {
  clientName: string;
  periodLabel: string;
  dateLabel: string;
  data: ClientReportData;
  sections: ReportSections;
  logo?: { buf: Buffer; mime: string } | null;
}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = doc.page.width, PH = doc.page.height, M = 40, W = PW - 2 * M;
    const BOTTOM = PH - 62;
    const INK = "#1e1e26", VIOLET = "#6e59f2", LAV = "#f2edff", GRAY = "#8b8f9e", DIM = "#9aa0ad",
          BORDER = "#e9e9f1", TEAL = "#12b886", LINE = "#ececf3";
    const d = opts.data, t = d.totals, s = opts.sections;

    const sectionTitle = (title: string) => {
      const y = doc.y;
      doc.roundedRect(M, y + 1, 5, 17, 2.5).fill(VIOLET);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text(title, M + 16, y, { width: W - 16 });
      doc.y = y + 26;
    };
    const bullets = (items: string[], card = false) => {
      const pad = card ? 16 : 0, bx = M + pad, tw = W - 2 * pad - 18;
      if (card) {
        doc.font("Helvetica").fontSize(10.5);
        let h = 14; for (const it of items) h += doc.heightOfString(it, { width: tw, lineGap: 1.5 }) + 7;
        if (doc.y + h > BOTTOM) doc.addPage();
        const y = doc.y; doc.roundedRect(M, y, W, h, 12).fill(LAV); doc.y = y + 14;
      }
      for (const it of items) {
        doc.font("Helvetica").fontSize(10.5);
        const need = doc.heightOfString(it, { width: tw, lineGap: 1.5 }) + 7;
        if (!card && doc.y + need > BOTTOM) doc.addPage();
        const y = doc.y;
        doc.circle(bx + 3, y + 6, 2.6).fill(VIOLET);
        doc.fillColor("#33333d").font("Helvetica").fontSize(10.5).text(it, bx + 16, y, { width: tw, lineGap: 1.5 });
        doc.y = doc.y + 7;
      }
      if (card) doc.y += 6;
      doc.y += 4;
    };

    // ===================== PÁGINA 1 =====================
    // Cabecera full-bleed
    const bandH = 132;
    const grad = doc.linearGradient(0, 0, PW, bandH); grad.stop(0, "#6d5bf2").stop(1, "#7c6ff5");
    doc.rect(0, 0, PW, bandH).fill(grad);
    doc.roundedRect(M, 28, 58, 58, 14).fill("#ffffff");
    if (opts.logo?.buf) {
      try { doc.image(opts.logo.buf, M + 7, 35, { fit: [44, 44] }); }
      catch { doc.fillColor(VIOLET).font("Helvetica-Bold").fontSize(15).text((opts.clientName || "?").slice(0, 4), M, 50, { width: 58, align: "center" }); }
    } else {
      doc.fillColor(VIOLET).font("Helvetica-Bold").fontSize(15).text((opts.clientName || "?").slice(0, 4), M, 50, { width: 58, align: "center" });
    }
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(23).text("Informe de rendimiento", M + 74, 38);
    doc.fillColor("#e5e0ff").font("Helvetica").fontSize(13).text(opts.clientName, M + 74, 70);
    doc.fillColor("#cfc6fb").font("Helvetica").fontSize(10.5).text(`${opts.periodLabel}  ·  ${opts.dateLabel}`, M + 74, 90);

    // Hero (tasa de respuesta)
    const heroY = bandH + 22, heroH = 86;
    doc.roundedRect(M, heroY, W, heroH, 16).fill(LAV);
    doc.fillColor(VIOLET).font("Helvetica-Bold").fontSize(34).text(ratePct(d.replyRate), M + 26, heroY + 24, { width: 150 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(14).text("Tasa de respuesta", M + 180, heroY + 24);
    doc.fillColor(GRAY).font("Helvetica").fontSize(10.5).text(`${nf(t.replies)} respuestas de ${nf(t.contacted)} personas contactadas`, M + 180, heroY + 46);

    // KPIs 3×2
    const cards = [
      { n: nf(t.contacted), l: "PERSONAS CONTACTADAS", sub: `+${nf(t.newContacted)} nuevas` },
      { n: nf(t.sent), l: "CORREOS ENVIADOS", sub: `${nf(t.sent)} en el periodo` },
      { n: nf(t.replies), l: "RESPUESTAS", sub: "" },
      { n: nf(t.interested), l: "INTERESADOS", sub: "marcados por la IA" },
      { n: nf(t.bounces), l: "REBOTES", sub: "" },
      { n: nf(t.remaining), l: "CONTACTOS RESTANTES", sub: "" },
    ];
    const gap = 14, cw = (W - 2 * gap) / 3, ch = 92, gy = heroY + heroH + 20;
    cards.forEach((k, i) => {
      const x = M + (i % 3) * (cw + gap), y = gy + Math.floor(i / 3) * (ch + gap);
      doc.roundedRect(x, y, cw, ch, 14).fillAndStroke("#ffffff", BORDER);
      doc.fillColor(INK).font("Helvetica-Bold").fontSize(21).text(k.n, x + 16, y + 16, { width: cw - 32 });
      doc.fillColor(GRAY).font("Helvetica-Bold").fontSize(8).text(k.l, x + 16, y + 50, { width: cw - 24, characterSpacing: 0.4 });
      if (k.sub) doc.fillColor(VIOLET).font("Helvetica").fontSize(9).text(k.sub, x + 16, y + 66, { width: cw - 24 });
    });
    doc.y = gy + 2 * ch + gap + 22;

    // Resumen ejecutivo
    sectionTitle("Resumen ejecutivo");
    doc.fillColor("#33333d").font("Helvetica").fontSize(10.5).text(s.summary, M, doc.y, { width: W, align: "justify" as Align, lineGap: 2.5 });
    doc.y += 16;
    // Lo más destacado
    sectionTitle("Lo más destacado");
    bullets(s.highlights, false);

    // ===================== PÁGINA 2 =====================
    doc.addPage();
    doc.y = M + 6;
    sectionTitle("Actividad diaria");
    drawDailyChart(d.daily, doc.y);

    sectionTitle("Detalle por campaña");
    drawTable(d.perCampaign);

    sectionTitle("Próximos pasos recomendados");
    bullets(s.nextSteps, true);

    sectionTitle("Qué vamos a mejorar");
    bullets(s.improvements, false);

    // Pie + paginación en todas las páginas
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      (doc.page as any).margins.bottom = 0;
      const ly = PH - 52;
      doc.moveTo(M, ly).lineTo(M + W, ly).lineWidth(1).strokeColor(LINE).stroke();
      doc.fillColor(DIM).font("Helvetica").fontSize(8.5)
        .text(`${opts.clientName} · Informe generado por OnePulso`, M, PH - 40, { width: W * 0.6, lineBreak: false });
      doc.fillColor(DIM).font("Helvetica").fontSize(8.5)
        .text(`Página ${i + 1} de ${range.count}`, M + W * 0.4, PH - 40, { width: W * 0.6, align: "right" as Align, lineBreak: false });
    }
    doc.end();

    function drawDailyChart(days: Array<{ label: string; sent: number; replies: number }>, top: number) {
      const chartH = 128, base = top + chartH, left = M, right = M + W;
      const maxV = Math.max(1, ...days.map((x) => Math.max(x.sent, x.replies)));
      const n = Math.max(1, days.length), slot = W / n, bw = Math.min(26, slot * 0.28);
      days.forEach((x, i) => {
        const cx = left + slot * i + slot / 2;
        const hS = (x.sent / maxV) * (chartH - 10), hR = (x.replies / maxV) * (chartH - 10);
        if (x.sent > 0) doc.roundedRect(cx - bw - 2, base - hS, bw, hS, 4).fill(VIOLET);
        if (x.replies > 0) doc.roundedRect(cx + 2, base - hR, bw, hR, 4).fill(TEAL);
      });
      doc.moveTo(left, base).lineTo(right, base).lineWidth(1).strokeColor(LINE).stroke();
      days.forEach((x, i) => {
        const cx = left + slot * i + slot / 2;
        doc.fillColor(DIM).font("Helvetica").fontSize(9).text(x.label, cx - slot / 2, base + 8, { width: slot, align: "center" as Align });
      });
      let ly = base + 26;
      doc.roundedRect(left, ly, 11, 11, 2.5).fill(VIOLET); doc.fillColor(GRAY).font("Helvetica").fontSize(9.5).text("Enviados", left + 17, ly + 1);
      doc.roundedRect(left + 95, ly, 11, 11, 2.5).fill(TEAL); doc.fillColor(GRAY).text("Respuestas", left + 112, ly + 1);
      doc.y = ly + 26;
    }

    function drawTable(rows: ClientReportData["perCampaign"]) {
      const cols: Array<{ t: string; w: number; a: Align }> = [
        { t: "Campaña", w: 0.34, a: "left" }, { t: "Contact.", w: 0.13, a: "right" },
        { t: "Enviados", w: 0.15, a: "right" }, { t: "Resp.", w: 0.12, a: "right" },
        { t: "Interes.", w: 0.13, a: "right" }, { t: "Tasa", w: 0.13, a: "right" },
      ];
      let y = doc.y;
      doc.roundedRect(M, y, W, 26, 6).fill(VIOLET);
      let x = M + 14; doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#ffffff");
      cols.forEach((c) => { const w = c.w * W; doc.text(c.t, x, y + 8, { width: w - (c.a === "right" ? 24 : 0), align: c.a }); x += w; });
      y += 26;
      const list = rows.length ? rows : [{ name: "(sin campañas)", contacted: 0, sent: 0, replies: 0, interested: 0 }];
      list.forEach((r, ri) => {
        if (y > BOTTOM - 24) { doc.addPage(); y = M + 6; }
        if (ri % 2 === 1) doc.rect(M, y, W, 24).fill("#faf9ff");
        x = M + 14;
        const cells = [r.name, nf(r.contacted), nf(r.sent), nf(r.replies), nf(r.interested), pctOf(r.replies, r.contacted)];
        cells.forEach((cell, ci) => {
          const c = cols[ci], w = c.w * W;
          doc.font("Helvetica").fontSize(9.5).fillColor(ci === 5 ? VIOLET : (ci === 0 ? INK : "#4b4b57"))
            .text(String(cell), x, y + 8, { width: w - (c.a === "right" ? 24 : 0), align: c.a, ellipsis: true });
          x += w;
        });
        y += 24;
      });
      doc.moveTo(M, y).lineTo(M + W, y).lineWidth(1).strokeColor(LINE).stroke();
      doc.y = y + 18;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generar (datos) + enviar
// ─────────────────────────────────────────────────────────────────────────────
export async function buildReportForClient(clientId: string, clientName: string, _intro: string, campaignIds?: string[]): Promise<Buffer> {
  const cfg = await getReportConfig(clientId, clientName);
  const camps = campaignIds ?? cfg.campaign_ids;
  const intervalHours = cfg.interval_hours || 48;
  const windowDays = Math.max(1, Math.ceil(intervalHours / 24));
  const periodLabel = `Últimas ${intervalHours} horas`;

  const data = await getClientReport(clientId, camps, { windowDays, dailyDays: 7 });
  const now = new Date();
  const dateLabel = now.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  const [context, logo] = await Promise.all([
    getClientReplyContext(clientId, camps).catch(() => ""),
    getReportLogo(),
  ]);
  const sections = await generateReportSections(clientName, data, periodLabel, context);
  return generateReportPDF({ clientName, periodLabel, dateLabel, data, sections, logo });
}

/** Genera el PDF y lo envía por email.
 *  - Sin opts: al destinatario configurado (envío real) → marca last_sent_at.
 *  - opts.overrideEmail: envío de PRUEBA a ese email → NO marca last_sent_at. */
export async function sendReportForClient(
  clientId: string,
  opts?: { overrideEmail?: string; test?: boolean }
): Promise<{ ok: boolean; to: string; bytes: number; test: boolean }> {
  const cfg = await getReportConfig(clientId);
  const isTest = !!(opts?.test || opts?.overrideEmail);
  const to = (opts?.overrideEmail || cfg.recipient_email || "").trim();
  if (!to) throw new Error(isTest ? "Escribe un email de prueba." : "Este cliente no tiene email de destino configurado.");
  const pdf = await buildReportForClient(clientId, cfg.client_name, cfg.pdf_intro, cfg.campaign_ids);

  // El mensaje al cliente se reescribe con IA en cada envío (no siempre igual).
  const baseBody = cfg.email_body_html || `<p>Hola,</p><p>Te adjunto el informe de rendimiento de tus campañas de las últimas 48 horas.</p><p>Cualquier duda, aquí estamos.</p><p>Un saludo</p>`;
  const variedBody = await varyMessageHtml(baseBody, cfg.client_name);

  const tmp = path.join(os.tmpdir(), `informe-${clientId}-${randomUUID()}.pdf`);
  await fs.writeFile(tmp, pdf);
  try {
    await sendEmail({
      to,
      subject: (isTest ? "[PRUEBA] " : "") + (cfg.email_subject || `Informe de rendimiento — ${cfg.client_name}`),
      body_html: (isTest ? `<p style="color:#b45309"><b>Esto es una PRUEBA</b> — así le llegará el informe al cliente.</p>` : "") + variedBody,
      attachments: [{ filename: `Informe-${cfg.client_name.replace(/[^\w\-]+/g, "_")}.pdf`, path: tmp }],
    });
  } finally {
    fs.unlink(tmp).catch(() => {});
  }
  if (!isTest) await saveReportConfig(clientId, { last_sent_at: new Date().toISOString() });
  return { ok: true, to, bytes: pdf.length, test: isTest };
}

/** Llamado por el scheduler: envía a los clientes activados cuyo intervalo venció. */
export async function runDueReports(): Promise<{ sent: number; errors: number }> {
  const cfgs = await listReportConfigs();
  const now = Date.now();
  let sent = 0, errors = 0;
  for (const c of cfgs) {
    if (!c.enabled || !c.recipient_email) continue;
    const last = c.last_sent_at ? new Date(c.last_sent_at).getTime() : 0;
    const intervalMs = (c.interval_hours || 48) * 3600_000;
    if (now - last < intervalMs) continue;
    try { await sendReportForClient(c.client_id); sent++; }
    catch (e: any) { errors++; console.error(`[client-reports] ${c.client_id} fallo:`, e?.message || e); }
  }
  return { sent, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerta diaria de interesados (18:00 España, escalonada por cliente)
// ─────────────────────────────────────────────────────────────────────────────

/** Email breve y positivo avisando al cliente de que HOY hay interesados/preguntas.
 *  Redactado por IA (varía cada vez); fallback determinista. */
async function generateInterestedAlertHtml(clientName: string, count: number): Promise<string> {
  const plural = count === 1;
  const base = `<p>Hola,</p><p>¡Buenas noticias! Hoy ${plural ? "una persona ha respondido con interés" : `${nf(count)} personas han respondido con interés`} a tu campaña. Ya lo estamos revisando para darle continuidad cuanto antes.</p><p>Te mantenemos al día.</p><p>Un saludo</p>`;
  try {
    const txt = await generateText({
      system: "Escribes emails MUY breves, cercanos y positivos de una agencia de cold email a su cliente. Devuelves solo HTML simple con <p>. Sin asunto, sin emojis, sin markdown.",
      prompt: `Escribe un email muy breve (2-3 frases, con otras palabras cada vez) avisando al cliente ${clientName} de que HOY ha habido ${count} respuesta(s) de personas interesadas o con preguntas en su campaña de cold email. Tono positivo y natural. No inventes más números ni detalles concretos. Español de España.`,
      maxTokens: 260, temperature: 0.9,
    });
    const out = (txt || "").replace(/```html?/gi, "").replace(/```/g, "").trim();
    if (out && out.includes("<p")) return out;
    if (out) return `<p>${out}</p>`;
  } catch (e: any) {
    console.warn("[client-reports] alerta IA no disponible:", e?.message);
  }
  return base;
}

/**
 * Chequeo DIARIO a las 18:00 (Europe/Madrid), escalonado por cliente para que los
 * envíos no se solapen. Para cada cliente con el informe ACTIVADO:
 *  - mira SOLO las respuestas de interesados/preguntas de HOY (Smartlead);
 *  - si hay al menos 1 → le envía un correo simple avisando;
 *  - si no hay ninguna hoy → no envía nada.
 * Se hace un único chequeo por día y cliente (marca last_alert_date).
 */
export async function runDailyInterestedAlerts(): Promise<{ checked: number; sent: number; errors: number }> {
  const { hour, minute, date } = madridNow();
  // Ventana 18:00–21:59 (tolera downtime del scheduler); el escalonado real es en la hora 18.
  if (hour < 18 || hour > 21) return { checked: 0, sent: 0, errors: 0 };

  const cfgs = await listReportConfigs();
  let checked = 0, sent = 0, errors = 0;
  for (const c of cfgs) {
    if (!c.enabled || !c.recipient_email) continue;   // solo clientes con informe activado
    if (c.last_alert_date === date) continue;          // ya revisado hoy
    // Escalonado: en la hora 18 cada cliente espera a su minuto; a partir de las 19 ya no espera.
    if (hour === 18 && minute < slotForClient(c.client_id)) continue;
    checked++;
    try {
      const { interested } = await getClientPositiveOnDate(c.client_id, c.campaign_ids, date);
      await saveReportConfig(c.client_id, { last_alert_date: date }); // un chequeo/día pase lo que pase
      if (interested > 0) {
        const html = await generateInterestedAlertHtml(c.client_name, interested);
        await sendEmail({
          to: c.recipient_email,
          subject: interested === 1 ? "Tienes una respuesta de un interesado" : `Tienes ${nf(interested)} respuestas de interesados`,
          body_html: html,
        });
        sent++;
        console.log(`[client-reports] alerta interesados → ${c.client_name} (${interested})`);
      }
    } catch (e: any) {
      errors++;
      console.error(`[client-reports] alerta ${c.client_id} fallo:`, e?.message || e);
    }
  }
  return { checked, sent, errors };
}

/** Lista de clientes de Smartlead + su config de informe (para la UI). */
export async function listClientsWithConfig(): Promise<Array<{ client_id: string; client_name: string; email?: string; config: ReportConfig }>> {
  const clients = await listClients();
  const out = [];
  for (const cl of clients) {
    const id = String(cl.id);
    const config = await getReportConfig(id, cl.name);
    out.push({ client_id: id, client_name: cl.name, email: cl.email, config });
  }
  return out;
}
