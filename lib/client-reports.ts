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
import { readJson, writeJson, deleteJson, listKeys } from "./storage";
import { getClientAnalytics, listClients, type CampaignStats } from "./smartlead";
import { sendEmail } from "./email-send";
import { generateText } from "./ai-providers";

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
  last_sent_at?: string | null;
  updated_at: string;
};

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

/** La IA redacta un análisis profesional de las métricas para el cliente. */
export async function generateReportAnalysis(clientName: string, stats: CampaignStats, campaigns: Array<{ name: string; stats: CampaignStats }>): Promise<string> {
  const top = campaigns.slice(0, 10).map((c) => `- ${c.name}: ${c.stats.sent} env, ${c.stats.opens} aperturas, ${c.stats.replies} respuestas, ${c.stats.bounces} rebotes`).join("\n");
  const prompt = `Cliente: ${clientName}

TOTALES DEL PERÍODO:
- Emails enviados: ${stats.sent}
- Aperturas: ${stats.opens} (${pct(stats.opens, stats.sent)})
- Respuestas: ${stats.replies} (${pct(stats.replies, stats.sent)})
- Rebotes: ${stats.bounces} (${pct(stats.bounces, stats.sent)})

CAMPAÑAS:
${top || "(sin campañas)"}

Escribe un análisis profesional para el cliente (3-4 párrafos cortos):
1) Resumen del rendimiento del período.
2) Qué está funcionando bien.
3) Qué conviene mejorar (si el % de respuesta es bajo, si hay muchos rebotes, etc.).
4) Recomendación concreta para el próximo período.
Tono profesional y directo. Sin markdown, sin emojis, sin títulos. Español de España.`;
  try {
    const txt = await generateText({
      system: "Eres analista senior de cold email B2B en una agencia. Redactas informes claros, honestos y accionables para el cliente final. Nada de florituras.",
      prompt, maxTokens: 700, temperature: 0.5,
    });
    return (txt || "").replace(/```/g, "").trim();
  } catch (e: any) {
    console.warn("[client-reports] análisis IA no disponible:", e?.message);
    // Fallback sin IA: resumen básico.
    return `En el período se enviaron ${stats.sent.toLocaleString("es")} emails, con ${stats.opens.toLocaleString("es")} aperturas (${pct(stats.opens, stats.sent)}), ${stats.replies.toLocaleString("es")} respuestas (${pct(stats.replies, stats.sent)}) y ${stats.bounces.toLocaleString("es")} rebotes (${pct(stats.bounces, stats.sent)}).`;
  }
}

export async function generateReportPDF(opts: {
  clientName: string;
  intro: string;
  analysis: string;
  stats: CampaignStats;
  campaigns: Array<{ name: string; stats: CampaignStats }>;
  dateLabel: string;
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
    const bottom = doc.page.height - 60;
    const ensure = (need: number) => { if (doc.y + need > bottom) doc.addPage(); };

    // Cabecera con marca
    doc.rect(LEFT, 44, 34, 34).fill(purple);
    doc.fillColor("#fff").fontSize(20).font("Helvetica-Bold").text("O", LEFT, 50, { width: 34, align: "center" });
    doc.fillColor(ink).fontSize(18).font("Helvetica-Bold").text("Informe de campañas", 92, 46);
    doc.fillColor(dim).fontSize(10).font("Helvetica").text("onepulso · powered by Smartlead", 92, 68);
    doc.moveTo(LEFT, 92).lineTo(LEFT + W, 92).strokeColor(line).stroke();

    doc.fillColor(ink).fontSize(15).font("Helvetica-Bold").text(opts.clientName, LEFT, 106);
    doc.fillColor(dim).fontSize(10).font("Helvetica").text(opts.dateLabel, LEFT, 126);

    let cursor = 150;
    if (opts.intro?.trim()) {
      doc.fillColor("#334155").fontSize(11).font("Helvetica").text(opts.intro.trim(), LEFT, cursor, { width: W });
      cursor = doc.y + 14;
    }

    // KPIs (4 cajas)
    const kpiY = cursor;
    const boxW = (W - 3 * 12) / 4;
    const s = opts.stats;
    const kpis = [
      { label: "Enviados", value: s.sent.toLocaleString("es"), sub: "" },
      { label: "Aperturas", value: s.opens.toLocaleString("es"), sub: pct(s.opens, s.sent) },
      { label: "Respuestas", value: s.replies.toLocaleString("es"), sub: pct(s.replies, s.sent) },
      { label: "Rebotes", value: s.bounces.toLocaleString("es"), sub: pct(s.bounces, s.sent) },
    ];
    kpis.forEach((k, i) => {
      const x = LEFT + i * (boxW + 12);
      doc.roundedRect(x, kpiY, boxW, 74, 10).fillAndStroke("#f8fafc", line);
      doc.fillColor(dim).fontSize(9).font("Helvetica").text(k.label.toUpperCase(), x + 12, kpiY + 12, { width: boxW - 24 });
      doc.fillColor(ink).fontSize(21).font("Helvetica-Bold").text(k.value, x + 12, kpiY + 28, { width: boxW - 24 });
      if (k.sub) doc.fillColor(purple).fontSize(10).font("Helvetica-Bold").text(k.sub, x + 12, kpiY + 54, { width: boxW - 24 });
    });
    doc.y = kpiY + 74 + 24;

    // Análisis (IA) — texto fluido, salta de página solo si hace falta.
    if (opts.analysis?.trim()) {
      doc.x = LEFT;
      doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Análisis", LEFT, doc.y);
      doc.moveDown(0.4);
      doc.fillColor("#334155").fontSize(10.5).font("Helvetica").text(opts.analysis.trim(), LEFT, doc.y, { width: W, align: "justify", lineGap: 2 });
      doc.y = doc.y + 18;
    }

    // Tabla de campañas
    ensure(70);
    doc.x = LEFT;
    doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Detalle por campaña", LEFT, doc.y);
    let y = doc.y + 8;
    const cols = [
      { t: "Campaña", w: W * 0.40 },
      { t: "Enviados", w: W * 0.15 },
      { t: "Aperturas", w: W * 0.15 },
      { t: "Respuestas", w: W * 0.15 },
      { t: "Rebotes", w: W * 0.15 },
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
      const cells = [r.name, r.stats.sent.toLocaleString("es"), r.stats.opens.toLocaleString("es"), r.stats.replies.toLocaleString("es"), r.stats.bounces.toLocaleString("es")];
      cells.forEach((cell, ci) => {
        doc.fillColor(ci === 0 ? ink : "#334155").text(String(cell), x, y, { width: cols[ci].w, ellipsis: true });
        x += cols[ci].w;
      });
      y += 20;
    }

    // Pie
    doc.fillColor(dim).fontSize(8).font("Helvetica").text(
      `Generado automáticamente el ${new Date().toLocaleString("es")} · onepulso`,
      LEFT, doc.page.height - 40, { width: W, align: "center" }
    );

    doc.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Generar (datos) + enviar
// ─────────────────────────────────────────────────────────────────────────────
export async function buildReportForClient(clientId: string, clientName: string, intro: string, campaignIds?: string[]): Promise<Buffer> {
  const { stats, campaigns } = await getClientAnalytics(clientId, campaignIds);
  const now = new Date();
  const dateLabel = `Período hasta ${now.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}`;
  const analysis = await generateReportAnalysis(clientName, stats, campaigns);
  return generateReportPDF({ clientName, intro, analysis, stats, campaigns, dateLabel });
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
