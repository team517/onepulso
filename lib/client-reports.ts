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
import { randomUUID } from "crypto";
import { readJson, writeJson, deleteJson, listKeys, readBlob, writeBlob } from "./storage";
import { getClientReport, getClientReplyContext, getClientPositiveOnDate, listClients, type ClientReportData } from "./smartlead";
import { sendEmail } from "./email-send";
import { getReportSmtp, isReportSmtpConfigured, sendViaReportSmtp } from "./report-smtp";
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
  /** Último viernes (YYYY-MM-DD, hora España) en que se envió el informe semanal. */
  last_weekly_date?: string;
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
// PDF almacenado (enlace público) + registro de envíos
// ─────────────────────────────────────────────────────────────────────────────
const PDF_PREFIX = "report-pdf/";   // blob:  report-pdf/{clientId}/{reportId}
const LOG_PREFIX = "client-report-log/";

export type ReportLogEntry = {
  reportId: string;
  at: string;            // ISO
  to: string;
  subject: string;
  bytes: number;
  test: boolean;
  ok: boolean;
  error?: string;
  link?: string;         // enlace al PDF (informes); vacío en avisos
  kind?: "report" | "weekly" | "alert"; // tipo de envío
};

/** ¿Es una URL local/no pública (no sirve para el enlace del cliente)? */
function isLocalUrl(u?: string): boolean {
  return !!u && /(^https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?/i.test(u);
}

/** Base URL pública para construir el enlace del PDF. Nunca devuelve localhost:
 *  usa el host reenviado (si es público) → env → host de EasyPanel. */
function reportBaseUrl(explicit?: string): string {
  const candidates = [explicit, process.env.APP_BASE_URL, process.env.NEXT_PUBLIC_APP_URL];
  const good = candidates.find((c) => c && c.trim() && !isLocalUrl(c));
  const raw = good || "https://backend-onepulso-onepulsorailway.25kofp.easypanel.host";
  return raw.trim().replace(/\/+$/, "");
}

/** Guarda el PDF como blob y devuelve su id (para el enlace público). */
export async function storeReportPdf(clientId: string, pdf: Buffer): Promise<string> {
  const reportId = randomUUID();
  await writeBlob(`${PDF_PREFIX}${clientId}/${reportId}`, pdf, "application/pdf");
  return reportId;
}

/** Lee el PDF guardado (para la ruta pública de descarga). */
export async function getReportPdfBlob(clientId: string, reportId: string): Promise<{ data: Buffer; mime: string } | null> {
  if (!/^[\w-]+$/.test(reportId)) return null;
  return (await readBlob(`${PDF_PREFIX}${clientId}/${reportId}`).catch(() => null)) || null;
}

/** Historial de informes enviados de un cliente (más reciente primero). */
export async function getReportLog(clientId: string): Promise<ReportLogEntry[]> {
  return (await readJson<ReportLogEntry[]>(`${LOG_PREFIX}${clientId}`)) ?? [];
}
async function appendReportLog(clientId: string, entry: ReportLogEntry): Promise<void> {
  const log = await getReportLog(clientId);
  log.unshift(entry);
  await writeJson(`${LOG_PREFIX}${clientId}`, log.slice(0, 60)); // conserva los últimos 60
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de formato / tiempo
// ─────────────────────────────────────────────────────────────────────────────
function nf(n: number): string { return Number(n || 0).toLocaleString("es-ES"); }

/** Hora actual en España (Europe/Madrid): {hour, minute, date, weekday}.
 *  weekday: 0=domingo, 1=lunes … 5=viernes, 6=sábado. */
function madridNow(): { hour: number; minute: number; date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const y = parseInt(get("year"), 10), mo = parseInt(get("month"), 10), d = parseInt(get("day"), 10);
  const hour = parseInt(get("hour"), 10) % 24; // "24" → 0
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay(); // día de la semana de esa fecha
  return { hour, minute: parseInt(get("minute"), 10), date: `${get("year")}-${get("month")}-${get("day")}`, weekday };
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

/** Envía un correo de informe usando la cuenta SMTP dedicada si está conectada;
 *  si no, la cuenta de Seguimientos. Lanza error si falla (para registrarlo). */
async function deliverReportEmail(to: string, subject: string, html: string): Promise<void> {
  const smtp = await getReportSmtp();
  if (isReportSmtpConfigured(smtp)) {
    await sendViaReportSmtp(smtp, { to, subject, html });
  } else {
    await sendEmail({ to, subject, body_html: html });
  }
}

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
  // Actividad reciente → el estudio se fija en lo ÚLTIMO (no solo totales).
  const recent = d.daily.slice(-5).filter((x) => x.sent || x.replies).map((x) => `${x.label}: ${x.sent} envíos, ${x.replies} resp.`).join(" · ") || "poca actividad estos últimos días";
  // Ángulo distinto en cada generación → el resumen NO sale siempre igual.
  const angles = [
    "el volumen alcanzado y el alcance conseguido",
    "la tasa de respuesta y el interés que se está generando",
    "las oportunidades de escalar en el próximo periodo",
    "el recorrido que queda por delante (contactos restantes)",
    "la evolución y el ritmo de los últimos días",
    "la calidad del encaje del mensaje con la audiencia",
  ];
  const angle = angles[Math.floor(Math.random() * angles.length)];
  const prompt = `Cliente: ${clientName}
Periodo: ${periodLabel}

MÉTRICAS ACTUALES (acumuladas hasta hoy):
- Personas contactadas: ${nf(t.contacted)}
- Correos enviados: ${nf(t.sent)}
- Respuestas: ${nf(t.replies)}
- Tasa de respuesta: ${ratePct(d.replyRate)}
- Interesados (marcados por la IA): ${nf(t.interested)}
- Contactos restantes por enviar: ${nf(t.remaining)}

ACTIVIDAD DE LOS ÚLTIMOS DÍAS:
${recent}

POR CAMPAÑA:
${camps || "(sin campañas)"}
${context ? `\nCONTEXTO DE RESPUESTAS REALES (solo para dar color, no cites literal):\n${context}\n` : ""}
Redacta un informe para el cliente final en 4 secciones. Devuelve EXCLUSIVAMENTE un JSON válido con esta forma:
{
  "summary": "1 párrafo (5-7 frases) de resumen ejecutivo",
  "highlights": ["4-5 frases de lo más destacado"],
  "nextSteps": ["4-5 acciones concretas para el próximo periodo"],
  "improvements": ["4-5 mejoras concretas del email/campaña"]
}

REGLAS ESTRICTAS:
- VARÍA el enfoque, el orden de las ideas y las palabras en CADA informe: que nunca parezca la misma plantilla. Esta vez enfoca especialmente en ${angle}, teniendo en cuenta la actividad de los últimos días.
- SIEMPRE en tono POSITIVO, motivador y profesional. El cliente debe quedar contento.
- Si los números son bajos, enmárcalo como "margen de crecimiento" u "oportunidad", NUNCA como problema o fallo.
- Si estamos en época de vacaciones (julio/agosto/Navidad), menciónalo como explicación natural (estacional).
- Puedes comparar con el promedio del sector (1-3% de respuesta) como referencia.
- NO menciones NUNCA rebotes, spam, bajas, errores de entrega ni nada negativo. Habla solo de contactados, enviados, respuestas, interés, oportunidades y recorrido.
- Usa los nombres reales de las campañas. Español de España. Sin markdown, sin emojis, sin títulos dentro de los textos.`;

  try {
    const txt = await generateText({
      system: "Eres un analista de cold email B2B de una agencia que redacta informes para el cliente final. Tu tono es SIEMPRE positivo y profesional, y VARÍAS la redacción y el enfoque en cada informe (nunca la misma plantilla). No mencionas nunca rebotes ni nada negativo. Devuelves solo JSON válido.",
      prompt, maxTokens: 1100, temperature: 0.9,
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

    // KPIs (sin rebotes — no se muestran en el estudio)
    const cards = [
      { n: nf(t.contacted), l: "PERSONAS CONTACTADAS", sub: `+${nf(t.newContacted)} nuevas` },
      { n: nf(t.sent), l: "CORREOS ENVIADOS", sub: "" },
      { n: nf(t.replies), l: "RESPUESTAS", sub: ratePct(d.replyRate) },
      { n: nf(t.interested), l: "INTERESADOS", sub: "marcados por la IA" },
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
export async function buildReportForClient(
  clientId: string,
  clientName: string,
  _intro: string,
  campaignIds?: string[],
  opts?: { windowDays?: number; periodLabel?: string; cumulative?: boolean }
): Promise<Buffer> {
  const cfg = await getReportConfig(clientId, clientName);
  const camps = campaignIds ?? cfg.campaign_ids;
  // Informe normal = ACUMULADO (estado actual, "de lo que llevamos"); el semanal
  // pasa windowDays:7 (ventana de la semana).
  const cumulative = opts?.cumulative ?? !opts?.windowDays;
  const windowDays = opts?.windowDays ?? 2;
  const periodLabel = opts?.periodLabel ?? (cumulative ? "Resultados hasta hoy" : `Últimas ${cfg.interval_hours || 48} horas`);

  const data = await getClientReport(clientId, camps, { windowDays, dailyDays: 7, cumulative });
  const now = new Date();
  const dateLabel = now.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
  const [context, logo] = await Promise.all([
    getClientReplyContext(clientId, camps).catch(() => ""),
    getReportLogo(),
  ]);
  const sections = await generateReportSections(clientName, data, periodLabel, context);
  return generateReportPDF({ clientName, periodLabel, dateLabel, data, sections, logo });
}

/** Genera el PDF, lo GUARDA (enlace público) y envía el correo con un LINK de
 *  descarga (no adjunto). Registra SIEMPRE el intento (éxito o fallo) en el historial.
 *  - Sin opts: al destinatario configurado (envío real) → marca last_sent_at.
 *  - opts.overrideEmail: envío de PRUEBA a ese email → NO marca last_sent_at. */
export async function sendReportForClient(
  clientId: string,
  opts?: { overrideEmail?: string; test?: boolean; baseUrl?: string; weekly?: boolean }
): Promise<{ ok: boolean; to: string; bytes: number; test: boolean; link: string; reportId: string }> {
  const cfg = await getReportConfig(clientId);
  const isTest = !!(opts?.test || opts?.overrideEmail);
  const weekly = !!opts?.weekly;
  const to = (opts?.overrideEmail || cfg.recipient_email || "").trim();
  if (!to) throw new Error(isTest ? "Escribe un email de prueba." : "Este cliente no tiene email de destino configurado.");

  // El informe semanal (viernes) usa ventana de 7 días; el normal, 48h.
  const pdf = await buildReportForClient(
    clientId, cfg.client_name, cfg.pdf_intro, cfg.campaign_ids,
    weekly ? { windowDays: 7, periodLabel: "Resumen de la semana" } : undefined
  );

  // Guardar el PDF y construir el enlace público de descarga.
  const reportId = await storeReportPdf(clientId, pdf);
  const link = `${reportBaseUrl(opts?.baseUrl)}/api/clients/${clientId}/report-file/${reportId}`;
  const subjectBase = weekly
    ? `Resumen semanal — ${cfg.client_name}`
    : (cfg.email_subject || `Informe de rendimiento — ${cfg.client_name}`);
  const subject = (isTest ? "[PRUEBA] " : "") + subjectBase;

  // El mensaje al cliente se reescribe con IA en cada envío (no siempre igual).
  const baseBody = cfg.email_body_html || `<p>Hola,</p><p>Te comparto el informe de rendimiento de tus campañas de las últimas 48 horas.</p><p>Cualquier duda, aquí estamos.</p><p>Un saludo</p>`;
  const variedBody = await varyMessageHtml(baseBody, cfg.client_name);

  // Enlace de descarga del PDF (texto/enlace limpio, sin botón).
  const linkBlock = `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;margin:18px 0"><a href="${link}" style="color:#6e59f2;font-weight:600">Ver el informe de resultados (PDF)</a></p>`;

  const testBanner = isTest ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;margin:0 0 12px">Vista de prueba · al cliente le llega igual, sin esta línea.</p>` : "";
  const body_html = testBanner + variedBody + linkBlock;

  let ok = false;
  let error: string | undefined;
  try {
    await deliverReportEmail(to, subject, body_html);
    ok = true;
  } catch (e: any) {
    error = e?.message || String(e);
    console.error(`[client-reports] envío ${clientId} → ${to} FALLÓ:`, error);
  }

  // Registro del envío (éxito o fallo) — SIEMPRE queda constancia.
  await appendReportLog(clientId, {
    reportId, at: new Date().toISOString(), to, subject, bytes: pdf.length, test: isTest, ok, error, link,
    kind: weekly ? "weekly" : "report",
  }).catch((e) => console.warn("[client-reports] no se pudo registrar el envío:", e?.message));

  if (!ok) throw new Error(error || "No se pudo enviar el informe.");
  if (!isTest) await saveReportConfig(clientId, { last_sent_at: new Date().toISOString() });
  return { ok: true, to, bytes: pdf.length, test: isTest, link, reportId };
}

/** Llamado por el scheduler: envía el informe de 48h a los clientes activados
 *  cuyo intervalo venció. SOLO de lunes a jueves: el fin de semana no se envía
 *  nada y el viernes se reserva para el informe SEMANAL (`runWeeklyReports`). */
const REPORT_HOUR = 11;          // hora de envío de informes (Europe/Madrid)
const REPORT_MAX_PER_TICK = 5;   // máx. informes por tick → no todos de golpe

export async function runDueReports(): Promise<{ sent: number; errors: number }> {
  const { weekday, hour, minute } = madridNow();
  // 5=viernes, 6=sábado, 0=domingo → no se envía el informe de 48h.
  if (weekday === 5 || weekday === 6 || weekday === 0) return { sent: 0, errors: 0 };
  // Solo en la franja de las 11:00 (hasta 13:59, por si el scheduler estuvo caído).
  if (hour < REPORT_HOUR || hour > REPORT_HOUR + 2) return { sent: 0, errors: 0 };

  const cfgs = await listReportConfigs();
  const now = Date.now();
  let sent = 0, errors = 0, done = 0;
  for (const c of cfgs) {
    if (done >= REPORT_MAX_PER_TICK) break;              // reparte en varios ticks
    if (!c.enabled || !c.recipient_email) continue;
    const last = c.last_sent_at ? new Date(c.last_sent_at).getTime() : 0;
    const intervalMs = (c.interval_hours || 48) * 3600_000;
    if (now - last < intervalMs) continue;
    // Escalonado: en la hora 11 cada cliente espera a su minuto; luego ya no.
    if (hour === REPORT_HOUR && minute < slotForClient(c.client_id)) continue;
    done++;
    try { await sendReportForClient(c.client_id); sent++; }
    catch (e: any) { errors++; console.error(`[client-reports] ${c.client_id} fallo:`, e?.message || e); }
  }
  return { sent, errors };
}

/** Informe SEMANAL: los VIERNES (España), a partir de las 17:00, envía a cada
 *  cliente activado un resumen de la semana (PDF de 7 días con gráficos + acciones
 *  a mejorar). Un único envío por viernes y cliente, escalonado para no solaparse. */
export async function runWeeklyReports(): Promise<{ sent: number; errors: number }> {
  const { weekday, hour, minute, date } = madridNow();
  if (weekday !== 5) return { sent: 0, errors: 0 };   // solo viernes
  // Misma franja que el resto de informes: 11:00 (hasta 14:59 por si hubo downtime).
  if (hour < REPORT_HOUR || hour > REPORT_HOUR + 3) return { sent: 0, errors: 0 };

  const cfgs = await listReportConfigs();
  let sent = 0, errors = 0, done = 0;
  for (const c of cfgs) {
    if (done >= REPORT_MAX_PER_TICK) break;
    if (!c.enabled || !c.recipient_email) continue;
    if (c.last_weekly_date === date) continue;                              // ya enviado este viernes
    if (hour === REPORT_HOUR && minute < slotForClient(c.client_id)) continue; // escalonado en la hora 11
    done++;
    try {
      await sendReportForClient(c.client_id, { weekly: true });
      sent++;
    } catch (e: any) {
      errors++;
      console.error(`[client-reports] semanal ${c.client_id} fallo:`, e?.message || e);
    }
    // Un intento por viernes (éxito o fallo queda en el historial).
    await saveReportConfig(c.client_id, { last_weekly_date: date }).catch(() => {});
  }
  return { sent, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerta diaria de interesados (18:00 España, escalonada por cliente)
// ─────────────────────────────────────────────────────────────────────────────

/** Email breve y positivo avisando al cliente de que HOY hay interesados/preguntas.
 *  Redactado por IA (varía cada vez); fallback determinista. */
async function generateInterestedAlertHtml(clientName: string, count: number): Promise<string> {
  const uno = count === 1;
  const quien = uno ? "una persona ha respondido" : `${nf(count)} personas han respondido`;
  const base = `<p>Hola,</p><p>Te escribimos para avisarte de una buena novedad: hoy ${quien} con interés a tu campaña de emails. Es una señal muy positiva de que tu propuesta está conectando con la audiencia.</p><p>Simplemente queríamos que lo tuvieras presente. Ya nos irás contando cómo evoluciona.</p><p>Un saludo,<br>El equipo de OnePulso</p>`;
  try {
    const txt = await generateText({
      system: "Escribes emails de AVISO de una agencia de cold email a su cliente. Tu único objetivo es INFORMAR de una novedad de forma cercana, educada y positiva. MUY IMPORTANTE: NO prometáis ni menciones ninguna acción por vuestra parte (nada de 'lo revisamos', 'te contamos el siguiente paso', 'lo gestionamos', 'le damos continuidad'); vosotros solo avisáis, no hacéis nada más. Longitud media: 3-4 frases (ni telegrama ni parrafada). HTML simple con etiquetas <p>. Sin asunto, sin emojis, sin markdown. Español de España. Varía la redacción y las palabras cada vez.",
      prompt: `Escribe un email para el cliente ${clientName} informándole de que HOY ${count} persona(s) han respondido con interés o con preguntas a su campaña de cold email. Felicítale por la buena señal y anímale, pero SOLO informas de la novedad (no prometas nada por vuestra parte). No inventes más números ni detalles concretos. Termina con un saludo cordial.`,
      maxTokens: 320, temperature: 0.95,
    });
    const out = (txt || "").replace(/```html?/gi, "").replace(/```/g, "").trim();
    if (out && out.includes("<p")) return out;
    if (out) return `<p>${out}</p>`;
  } catch (e: any) {
    console.warn("[client-reports] alerta IA no disponible:", e?.message);
  }
  return base;
}

/** Envía a `toEmail` un EJEMPLO del aviso de interesados (para previsualizarlo).
 *  Usa los interesados reales de hoy; si hoy no hay, muestra un ejemplo con 2. */
export async function sendAlertPreview(clientId: string, toEmail: string): Promise<{ ok: boolean; to: string }> {
  const cfg = await getReportConfig(clientId);
  const to = (toEmail || "").trim();
  if (!to) throw new Error("Escribe un email de prueba.");
  let count = 0;
  try { count = (await getClientPositiveOnDate(clientId, cfg.campaign_ids, madridNow().date)).interested; } catch {}
  const sample = count > 0 ? count : 2;
  const note = count > 0
    ? ""
    : `<p style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#94a3b8;margin:0 0 12px">Vista de prueba · hoy no hay interesados reales, te mostramos un ejemplo con ${sample}.</p>`;
  const html = await generateInterestedAlertHtml(cfg.client_name, sample);
  const subject = "[PRUEBA] " + (sample === 1 ? "Tienes una respuesta de un interesado" : `Tienes ${nf(sample)} respuestas de interesados`);
  await deliverReportEmail(to, subject, note + html);
  return { ok: true, to };
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
  const { hour, minute, date, weekday } = madridNow();
  if (weekday === 0 || weekday === 6) return { checked: 0, sent: 0, errors: 0 }; // fin de semana: silencio
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
        const subject = interested === 1 ? "Tienes una respuesta de un interesado" : `Tienes ${nf(interested)} respuestas de interesados`;
        let aok = false, aerr: string | undefined;
        try { await deliverReportEmail(c.recipient_email, subject, html); aok = true; sent++; }
        catch (e: any) { aerr = e?.message || String(e); errors++; }
        // El aviso también queda en el registro del cliente.
        await appendReportLog(c.client_id, {
          reportId: `alert-${date}`, at: new Date().toISOString(), to: c.recipient_email,
          subject, bytes: 0, test: false, ok: aok, error: aerr, kind: "alert",
        }).catch(() => {});
        if (aok) console.log(`[client-reports] alerta interesados → ${c.client_name} (${interested})`);
      }
    } catch (e: any) {
      errors++;
      console.error(`[client-reports] alerta ${c.client_id} fallo:`, e?.message || e);
    }
  }
  return { checked, sent, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Asistente IA por cliente (dentro de Clientes)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Ejecuta el asistente de un cliente con sus DATOS REALES de Smartlead (métricas
 * acumuladas + respuestas de interesados). Dos modos:
 *  - "prompt": asistente libre, responde a lo que pidas sobre el cliente.
 *  - "atencion": gestor de cuentas / atención al cliente (redacta y comunica en
 *    positivo, sin mencionar rebotes).
 */
export async function runClientAgent(
  clientId: string,
  message: string,
  mode: "prompt" | "atencion"
): Promise<{ answer: string }> {
  const cfg = await getReportConfig(clientId);
  const [data, replies] = await Promise.all([
    getClientReport(clientId, cfg.campaign_ids, { cumulative: true, dailyDays: 7 }).catch(() => null),
    getClientReplyContext(clientId, cfg.campaign_ids).catch(() => ""),
  ]);

  let ctx = `Cliente: ${cfg.client_name}`;
  if (data) {
    const t = data.totals;
    const perC = data.perCampaign.slice(0, 8).map((c) => `- ${c.name}: ${nf(c.sent)} enviados, ${nf(c.replies)} respuestas (${pctOf(c.replies, c.contacted)}), ${nf(c.interested)} interesados`).join("\n");
    const recent = data.daily.slice(-5).filter((x) => x.sent || x.replies).map((x) => `${x.label}: ${x.sent} env., ${x.replies} resp.`).join(" · ") || "poca actividad reciente";
    ctx += `\nMÉTRICAS (acumulado Smartlead): contactados ${nf(t.contacted)}, enviados ${nf(t.sent)}, respuestas ${nf(t.replies)} (${ratePct(data.replyRate)}), interesados ${nf(t.interested)}, contactos restantes ${nf(t.remaining)}.\nÚltimos días: ${recent}\nPor campaña:\n${perC}`;
  }
  if (replies) ctx += `\n\nRESPUESTAS REALES DE INTERESADOS (unibox de Smartlead):\n${replies}`;

  const system = mode === "atencion"
    ? `Eres el gestor de cuentas y atención al cliente de la agencia de cold email OnePulso para el cliente "${cfg.client_name}". Ayudas a comunicarte con él de forma profesional, cercana y positiva: responder sus dudas, explicarle resultados, proponer siguientes pasos y redactar mensajes listos para enviar. Usa sus datos reales. NUNCA menciones rebotes ni nada negativo; enmárcalo todo en positivo, oportunidades y recorrido. Español de España.`
    : `Eres el asistente de la agencia OnePulso para el cliente "${cfg.client_name}". Tienes sus datos reales de Smartlead. Responde a lo que te pida el usuario de forma útil, concreta y accionable. Español de España.`;

  const answer = await generateText({
    system: `${system}\n\nDATOS DEL CLIENTE:\n${ctx}`,
    prompt: message,
    maxTokens: 1200,
    temperature: 0.7,
  });
  return { answer: (answer || "").trim() || "(sin respuesta)" };
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
