/**
 * Informes PDF por cliente (analíticas de Smartlead) + envío automático.
 *
 * Config por cliente en kv `client-report-config/{clientId}`:
 *   recipient_email, email_subject, email_body_html, pdf_intro, enabled,
 *   interval_hours (def 48), last_sent_at, client_name.
 * Genera un PDF con pdfkit y lo envía por email (adjunto) con la cuenta
 * conectada en Seguimientos (sendEmail).
 */
import PDFDocument from "pdfkit";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import { readJson, writeJson, deleteJson, listKeys, readBlob } from "./storage";
import { getClientAnalytics, listClients, type CampaignStats } from "./smartlead";
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
  /** Unibox del que la IA lee mensajes recientes para dar contexto (opcional). */
  context_unibox_id?: string;
  last_sent_at?: string | null;
  updated_at: string;
};

/** Lee previews de mensajes RECIBIDOS recientes de un unibox → contexto para la IA. */
async function uniboxContext(uniboxId?: string): Promise<string> {
  if (!uniboxId) return "";
  try {
    const { listMessagesPage } = await import("./unibox-messages-db");
    const { messages } = await listMessagesPage({ uniboxId, showWarmup: false, limit: 60 });
    const inbound = (messages || []).filter((m: any) => !m.is_sent && (m.preview || "").trim()).slice(0, 6);
    if (inbound.length === 0) return "";
    return inbound.map((m: any) => `- ${m.subject || "(sin asunto)"}: ${String(m.preview).slice(0, 160)}`).join("\n");
  } catch { return ""; }
}

function defaults(clientId: string, clientName: string): ReportConfig {
  return {
    client_id: clientId,
    client_name: clientName,
    recipient_email: "",
    email_subject: `Informe de campañas — ${clientName}`,
    email_body_html: `<p>Hola,</p><p>Te adjunto el informe de rendimiento de tus campañas de esta semana.</p><p>Cualquier duda, aquí estamos.</p><p>Un saludo</p>`,
    pdf_intro: "Resumen de rendimiento de las campañas de cold email en el período.",
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
// PDF
// ─────────────────────────────────────────────────────────────────────────────
function pct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

/** La IA redacta un análisis profesional y POSITIVO de las métricas. */
export async function generateReportAnalysis(
  clientName: string,
  stats: CampaignStats,
  campaigns: Array<{ name: string; stats: CampaignStats }>,
  context?: string
): Promise<string> {
  // Por campaña, con sus % (las tratamos como "variantes" del período).
  const top = campaigns.slice(0, 12).map((c) => {
    const or = pct(c.stats.opens, c.stats.sent), rr = pct(c.stats.replies, c.stats.sent);
    return `- ${c.name}: ${c.stats.sent} enviados · aperturas ${c.stats.opens} (${or}) · respuestas ${c.stats.replies} (${rr})`;
  }).join("\n");
  const prompt = `Cliente: ${clientName}

TOTALES DEL PERÍODO:
- Emails enviados: ${stats.sent}
- Aperturas: ${stats.opens} (${pct(stats.opens, stats.sent)})
- Respuestas: ${stats.replies} (${pct(stats.replies, stats.sent)})

RENDIMIENTO POR CAMPAÑA (analiza los % de cada una como si fueran variantes):
${top || "(sin campañas)"}
${context ? `\nCONTEXTO DE CONVERSACIONES REALES (para dar color, no cites literal):\n${context}\n` : ""}
Escribe un análisis profesional para el cliente (3-4 párrafos cortos):
1) Resumen del rendimiento del período, destacando lo conseguido (envíos, alcance, aperturas, respuestas).
2) Qué campañas/% están funcionando mejor y por qué (compara sus porcentajes).
3) Oportunidades de crecimiento para el próximo período (en clave de mejora y potencial, nunca como fallo).

REGLAS ESTRICTAS:
- SIEMPRE en tono POSITIVO y motivador. El cliente tiene que quedarse con buena sensación.
- NO menciones NUNCA rebotes, bounces, spam, ni nada negativo. Habla solo de aperturas, respuestas, alcance, interés y oportunidades.
- Si un número es bajo, enmárcalo como "margen de crecimiento" u "oportunidad", nunca como problema.
- Sin markdown, sin emojis, sin títulos. Español de España. Profesional y cercano.`;
  try {
    const txt = await generateText({
      system: "Eres un analista de cold email B2B de una agencia que redacta informes para el cliente final. Tu tono es SIEMPRE positivo, motivador y profesional: destacas logros y oportunidades, y jamás hablas de rebotes ni de nada negativo. El cliente debe quedar contento con los resultados.",
      prompt, maxTokens: 750, temperature: 0.55,
    });
    return (txt || "").replace(/```/g, "").trim();
  } catch (e: any) {
    console.warn("[client-reports] análisis IA no disponible:", e?.message);
    return `En el período se enviaron ${stats.sent.toLocaleString("es")} emails, alcanzando ${stats.opens.toLocaleString("es")} aperturas (${pct(stats.opens, stats.sent)}) y generando ${stats.replies.toLocaleString("es")} respuestas (${pct(stats.replies, stats.sent)}). Un buen punto de partida con margen para seguir creciendo el próximo período.`;
  }
}

export async function generateReportPDF(opts: {
  clientName: string;
  intro: string;
  analysis: string;
  stats: CampaignStats;
  campaigns: Array<{ name: string; stats: CampaignStats }>;
  dateLabel: string;
  logo?: { buf: Buffer; mime: string } | null;
}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const LEFT = 48;
    const W = doc.page.width - 96;
    const purple = "#7c3aed", ink = "#0f172a", dim = "#64748b", line = "#e2e8f0";
    const green = "#10b981", blue = "#3b82f6";
    const bottom = doc.page.height - 60;
    const ensure = (need: number) => { if (doc.y + need > bottom) doc.addPage(); };

    // Cabecera con LOGO (si hay) o marca "O"
    if (opts.logo?.buf) {
      try { doc.image(opts.logo.buf, LEFT, 42, { fit: [40, 40] }); }
      catch { doc.rect(LEFT, 44, 34, 34).fill(purple); doc.fillColor("#fff").fontSize(20).font("Helvetica-Bold").text("O", LEFT, 50, { width: 34, align: "center" }); }
    } else {
      doc.rect(LEFT, 44, 34, 34).fill(purple);
      doc.fillColor("#fff").fontSize(20).font("Helvetica-Bold").text("O", LEFT, 50, { width: 34, align: "center" });
    }
    doc.fillColor(ink).fontSize(18).font("Helvetica-Bold").text("Informe de campañas", 96, 46);
    doc.fillColor(dim).fontSize(10).font("Helvetica").text("Resultados y evolución del período", 96, 68);
    doc.moveTo(LEFT, 92).lineTo(LEFT + W, 92).strokeColor(line).stroke();

    doc.fillColor(ink).fontSize(15).font("Helvetica-Bold").text(opts.clientName, LEFT, 106);
    doc.fillColor(dim).fontSize(10).font("Helvetica").text(opts.dateLabel, LEFT, 126);

    let cursor = 150;
    if (opts.intro?.trim()) {
      doc.fillColor("#334155").fontSize(11).font("Helvetica").text(opts.intro.trim(), LEFT, cursor, { width: W });
      cursor = doc.y + 14;
    }

    // KPIs POSITIVOS (sin rebotes) — 4 cajas
    const kpiY = cursor;
    const boxW = (W - 3 * 12) / 4;
    const s = opts.stats;
    const kpis = [
      { label: "Emails enviados", value: s.sent.toLocaleString("es"), sub: "alcance" },
      { label: "Aperturas", value: s.opens.toLocaleString("es"), sub: pct(s.opens, s.sent) },
      { label: "Respuestas", value: s.replies.toLocaleString("es"), sub: pct(s.replies, s.sent) },
      { label: "Tasa de respuesta", value: pct(s.replies, s.sent), sub: "del total" },
    ];
    kpis.forEach((k, i) => {
      const x = LEFT + i * (boxW + 12);
      doc.roundedRect(x, kpiY, boxW, 74, 10).fillAndStroke("#f8fafc", line);
      doc.fillColor(dim).fontSize(8.5).font("Helvetica").text(k.label.toUpperCase(), x + 10, kpiY + 12, { width: boxW - 20 });
      doc.fillColor(ink).fontSize(20).font("Helvetica-Bold").text(k.value, x + 10, kpiY + 28, { width: boxW - 20 });
      doc.fillColor(purple).fontSize(9.5).font("Helvetica-Bold").text(k.sub, x + 10, kpiY + 55, { width: boxW - 20 });
    });
    doc.y = kpiY + 74 + 26;

    // GRÁFICO: aperturas y respuestas por campaña (barras horizontales)
    const chartCamps = [...opts.campaigns].sort((a, b) => b.stats.sent - a.stats.sent).slice(0, 6);
    if (chartCamps.length > 0) {
      ensure(40 + chartCamps.length * 34);
      doc.x = LEFT;
      doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Rendimiento por campaña", LEFT, doc.y);
      // Leyenda
      let ly = doc.y + 6;
      doc.rect(LEFT, ly + 2, 9, 9).fill(blue); doc.fillColor(dim).fontSize(9).font("Helvetica").text("Aperturas", LEFT + 14, ly);
      doc.rect(LEFT + 90, ly + 2, 9, 9).fill(green); doc.fillColor(dim).fontSize(9).text("Respuestas", LEFT + 104, ly);
      let cy = ly + 22;
      const labelW = W * 0.32, barMaxW = W - labelW - 60;
      const maxVal = Math.max(1, ...chartCamps.map((c) => c.stats.opens));
      for (const c of chartCamps) {
        if (cy > bottom - 40) { doc.addPage(); cy = 60; }
        doc.fillColor(ink).fontSize(9).font("Helvetica").text(c.name, LEFT, cy, { width: labelW - 8, ellipsis: true, height: 12 });
        const ow = Math.max(2, (c.stats.opens / maxVal) * barMaxW);
        const rw = Math.max(1, (c.stats.replies / maxVal) * barMaxW);
        doc.roundedRect(LEFT + labelW, cy, ow, 8, 3).fill(blue);
        doc.roundedRect(LEFT + labelW, cy + 12, rw, 8, 3).fill(green);
        doc.fillColor(dim).fontSize(8).font("Helvetica").text(`${c.stats.opens} · ${pct(c.stats.opens, c.stats.sent)}`, LEFT + labelW + ow + 4, cy - 1);
        doc.fillColor(dim).fontSize(8).text(`${c.stats.replies} · ${pct(c.stats.replies, c.stats.sent)}`, LEFT + labelW + rw + 4, cy + 11);
        cy += 34;
      }
      doc.y = cy + 6;
    }

    // Análisis (IA) — texto fluido positivo.
    if (opts.analysis?.trim()) {
      ensure(60);
      doc.x = LEFT;
      doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Análisis del período", LEFT, doc.y);
      doc.moveDown(0.4);
      doc.fillColor("#334155").fontSize(10.5).font("Helvetica").text(opts.analysis.trim(), LEFT, doc.y, { width: W, align: "justify", lineGap: 2 });
      doc.y = doc.y + 18;
    }

    // Tabla por campaña (sin rebotes)
    ensure(70);
    doc.x = LEFT;
    doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Detalle por campaña", LEFT, doc.y);
    let y = doc.y + 8;
    const cols = [
      { t: "Campaña", w: W * 0.40 },
      { t: "Enviados", w: W * 0.18 },
      { t: "Aperturas", w: W * 0.21 },
      { t: "Respuestas", w: W * 0.21 },
    ];
    let x = LEFT;
    doc.fontSize(9).font("Helvetica-Bold").fillColor(dim);
    cols.forEach((c) => { doc.text(c.t.toUpperCase(), x, y, { width: c.w }); x += c.w; });
    y += 16;
    doc.moveTo(LEFT, y).lineTo(LEFT + W, y).strokeColor(line).stroke();
    y += 6;

    doc.font("Helvetica").fontSize(10);
    const rows = opts.campaigns.length ? opts.campaigns : [{ name: "(sin campañas)", stats: { sent: 0, opens: 0, replies: 0, bounces: 0, clicks: 0, total: 0 } }];
    for (const r of rows) {
      if (y > bottom - 20) { doc.addPage(); y = 60; }
      x = LEFT;
      const cells = [
        r.name,
        r.stats.sent.toLocaleString("es"),
        `${r.stats.opens.toLocaleString("es")} (${pct(r.stats.opens, r.stats.sent)})`,
        `${r.stats.replies.toLocaleString("es")} (${pct(r.stats.replies, r.stats.sent)})`,
      ];
      cells.forEach((cell, ci) => {
        doc.fillColor(ci === 0 ? ink : "#334155").text(String(cell), x, y, { width: cols[ci].w, ellipsis: true });
        x += cols[ci].w;
      });
      y += 20;
    }

    doc.fillColor(dim).fontSize(8).font("Helvetica").text(
      `Generado el ${new Date().toLocaleDateString("es")} · onepulso`,
      LEFT, doc.page.height - 40, { width: W, align: "center" }
    );

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generar (datos) + enviar
// ─────────────────────────────────────────────────────────────────────────────
export async function buildReportForClient(clientId: string, clientName: string, intro: string, campaignIds?: string[]): Promise<Buffer> {
  const cfg = await getReportConfig(clientId, clientName);
  const { stats, campaigns } = await getClientAnalytics(clientId, campaignIds ?? cfg.campaign_ids);
  const now = new Date();
  const dateLabel = `Período hasta ${now.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}`;
  const [context, logo] = await Promise.all([uniboxContext(cfg.context_unibox_id), getReportLogo()]);
  const analysis = await generateReportAnalysis(clientName, stats, campaigns, context);
  return generateReportPDF({ clientName, intro, analysis, stats, campaigns, dateLabel, logo });
}

/** Genera el PDF y lo envía por email.
 *  - Sin opts: al destinatario configurado (envío real) → marca last_sent_at.
 *  - opts.overrideEmail: envío de PRUEBA a ese email (p.ej. el tuyo) → NO marca
 *    last_sent_at (no cuenta como enviado al cliente). */
export async function sendReportForClient(
  clientId: string,
  opts?: { overrideEmail?: string; test?: boolean }
): Promise<{ ok: boolean; to: string; bytes: number; test: boolean }> {
  const cfg = await getReportConfig(clientId);
  const isTest = !!(opts?.test || opts?.overrideEmail);
  const to = (opts?.overrideEmail || cfg.recipient_email || "").trim();
  if (!to) throw new Error(isTest ? "Escribe un email de prueba." : "Este cliente no tiene email de destino configurado.");
  const pdf = await buildReportForClient(clientId, cfg.client_name, cfg.pdf_intro, cfg.campaign_ids);

  // sendEmail adjunta por RUTA → escribimos el PDF a un temp file.
  const tmp = path.join(os.tmpdir(), `informe-${clientId}-${randomUUID()}.pdf`);
  await fs.writeFile(tmp, pdf);
  try {
    await sendEmail({
      to,
      subject: (isTest ? "[PRUEBA] " : "") + (cfg.email_subject || `Informe de campañas — ${cfg.client_name}`),
      body_html: (isTest ? `<p style="color:#b45309"><b>Esto es una PRUEBA</b> — así le llegará el informe al cliente.</p>` : "") + (cfg.email_body_html || `<p>Adjunto el informe de campañas.</p>`),
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
