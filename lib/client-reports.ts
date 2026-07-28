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
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const PW = doc.page.width, PH = doc.page.height;
    const LEFT = 42, W = PW - 84;
    const ink = "#0f172a", dim = "#64748b", line = "#e6e9ef", soft = "#f4f6fa";
    const purple = "#7c3aed", blue = "#3b82f6", green = "#10b981", teal = "#14b8a6";
    const bottom = PH - 54;
    const s = opts.stats;
    const rate = s.sent ? s.replies / s.sent : 0;
    const openRate = s.sent ? s.opens / s.sent : 0;

    const drawDonut = (cx: number, cy: number, r: number, th: number, p01: number, color: string, centerText: string) => {
      doc.save();
      doc.lineWidth(th).circle(cx, cy, r).stroke("#e9ecf3");
      const p = Math.max(0, Math.min(1, p01));
      if (p > 0.001) {
        const a0 = -Math.PI / 2, a1 = a0 + p * 2 * Math.PI;
        const sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0);
        const ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1);
        const large = p > 0.5 ? 1 : 0;
        doc.path(`M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`).lineWidth(th).lineCap("round").stroke(color);
      }
      doc.restore();
      doc.fillColor(ink).font("Helvetica-Bold").fontSize(11).text(centerText, cx - r, cy - 6, { width: r * 2, align: "center" });
    };

    // ── CABECERA con banda de gradiente (full-bleed) ──
    const grad = doc.linearGradient(0, 0, PW, 0);
    grad.stop(0, "#6d28d9").stop(1, "#a855f7");
    doc.rect(0, 0, PW, 110).fill(grad);
    // Logo sobre cuadro blanco
    doc.roundedRect(LEFT, 30, 50, 50, 12).fill("#ffffff");
    if (opts.logo?.buf) {
      try { doc.image(opts.logo.buf, LEFT + 5, 35, { fit: [40, 40] }); }
      catch { doc.fillColor(purple).fontSize(26).font("Helvetica-Bold").text("O", LEFT, 42, { width: 50, align: "center" }); }
    } else {
      doc.fillColor(purple).fontSize(26).font("Helvetica-Bold").text("O", LEFT, 42, { width: 50, align: "center" });
    }
    doc.fillColor("#ffffff").fontSize(19).font("Helvetica-Bold").text("Informe de campañas", LEFT + 62, 40);
    doc.fillColor("#ede9fe").fontSize(10).font("Helvetica").text("Resultados y evolución del período", LEFT + 62, 66);
    // Cliente + fecha a la derecha
    doc.fillColor("#ffffff").fontSize(13).font("Helvetica-Bold").text(opts.clientName, LEFT, 42, { width: W, align: "right" });
    doc.fillColor("#ddd6fe").fontSize(9.5).font("Helvetica").text(opts.dateLabel, LEFT, 62, { width: W, align: "right" });

    let cy = 128;
    if (opts.intro?.trim()) {
      doc.fillColor("#475569").fontSize(10.5).font("Helvetica").text(opts.intro.trim(), LEFT, cy, { width: W, lineGap: 1 });
      cy = doc.y + 12;
    }

    // ── KPI cards: 3 números + 1 donut ──
    const gap = 12, boxW = (W - 3 * gap) / 4, boxH = 82;
    const cardsY = cy;
    const numCards = [
      { label: "Emails enviados", value: s.sent.toLocaleString("es"), accent: blue },
      { label: "Aperturas", value: s.opens.toLocaleString("es"), accent: teal, extra: pct(s.opens, s.sent) },
      { label: "Respuestas", value: s.replies.toLocaleString("es"), accent: green, extra: pct(s.replies, s.sent) },
    ];
    numCards.forEach((k, i) => {
      const x = LEFT + i * (boxW + gap);
      doc.roundedRect(x, cardsY, boxW, boxH, 12).fillAndStroke("#ffffff", line);
      doc.roundedRect(x, cardsY, boxW, 4, 2).fill(k.accent);
      doc.fillColor(dim).fontSize(8).font("Helvetica-Bold").text(k.label.toUpperCase(), x + 12, cardsY + 14, { width: boxW - 24 });
      doc.fillColor(ink).fontSize(23).font("Helvetica-Bold").text(k.value, x + 12, cardsY + 30, { width: boxW - 24 });
      if (k.extra) doc.fillColor(k.accent).fontSize(10).font("Helvetica-Bold").text(k.extra, x + 12, cardsY + 60, { width: boxW - 24 });
    });
    // Card donut (tasa de respuesta)
    const dx = LEFT + 3 * (boxW + gap);
    doc.roundedRect(dx, cardsY, boxW, boxH, 12).fillAndStroke("#ffffff", line);
    doc.roundedRect(dx, cardsY, boxW, 4, 2).fill(purple);
    doc.fillColor(dim).fontSize(8).font("Helvetica-Bold").text("TASA RESPUESTA", dx + 12, cardsY + 12, { width: boxW - 24 });
    drawDonut(dx + boxW / 2, cardsY + 50, 17, 6, rate, purple, pct(s.replies, s.sent));
    doc.y = cardsY + boxH + 22;

    // ── GRÁFICO: barras por campaña (con track de fondo) ──
    const chartCamps = [...opts.campaigns].sort((a, b) => b.stats.sent - a.stats.sent).slice(0, 6);
    if (chartCamps.length > 0) {
      if (doc.y + 40 + chartCamps.length * 32 > bottom) doc.addPage();
      doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Rendimiento por campaña", LEFT, doc.y);
      let ly = doc.y + 4;
      doc.roundedRect(LEFT, ly + 2, 9, 9, 2).fill(teal); doc.fillColor(dim).fontSize(9).font("Helvetica").text("Aperturas", LEFT + 14, ly);
      doc.roundedRect(LEFT + 92, ly + 2, 9, 9, 2).fill(green); doc.fillColor(dim).fontSize(9).text("Respuestas", LEFT + 106, ly);
      let by = ly + 22;
      const labelW = W * 0.30, barMaxW = W - labelW - 62;
      const maxVal = Math.max(1, ...chartCamps.map((c) => c.stats.opens));
      for (const c of chartCamps) {
        if (by > bottom - 34) { doc.addPage(); by = 56; }
        doc.fillColor(ink).fontSize(9).font("Helvetica").text(c.name, LEFT, by + 3, { width: labelW - 8, ellipsis: true, height: 14 });
        const bx = LEFT + labelW;
        const ow = Math.max(3, (c.stats.opens / maxVal) * barMaxW);
        const rw = Math.max(2, (c.stats.replies / maxVal) * barMaxW);
        // track + barras
        doc.roundedRect(bx, by, barMaxW, 8, 4).fill(soft);
        doc.roundedRect(bx, by, ow, 8, 4).fill(teal);
        doc.roundedRect(bx, by + 12, barMaxW, 8, 4).fill(soft);
        doc.roundedRect(bx, by + 12, rw, 8, 4).fill(green);
        doc.fillColor(dim).fontSize(8).font("Helvetica").text(pct(c.stats.opens, c.stats.sent), bx + barMaxW + 6, by - 1, { width: 48 });
        doc.fillColor(dim).fontSize(8).text(pct(c.stats.replies, c.stats.sent), bx + barMaxW + 6, by + 11, { width: 48 });
        by += 32;
      }
      doc.y = by + 4;
    }

    // ── Análisis (IA) en tarjeta con acento ──
    if (opts.analysis?.trim()) {
      const text = opts.analysis.trim();
      doc.fontSize(10.5).font("Helvetica");
      const th = doc.heightOfString(text, { width: W - 34, lineGap: 2 });
      const cardH = th + 42;
      if (doc.y + cardH > bottom) doc.addPage();
      const ay = doc.y;
      doc.roundedRect(LEFT, ay, W, cardH, 10).fillAndStroke("#faf5ff", "#efe6fd");
      doc.roundedRect(LEFT, ay, 4, cardH, 2).fill(purple);
      doc.fillColor(purple).fontSize(12).font("Helvetica-Bold").text("Análisis del período", LEFT + 16, ay + 12);
      doc.fillColor("#334155").fontSize(10.5).font("Helvetica").text(text, LEFT + 16, ay + 30, { width: W - 34, align: "justify", lineGap: 2 });
      doc.y = ay + cardH + 18;
    }

    // ── Tabla con cabecera y filas alternas ──
    if (doc.y + 60 > bottom) doc.addPage();
    doc.fillColor(ink).fontSize(13).font("Helvetica-Bold").text("Detalle por campaña", LEFT, doc.y);
    let y = doc.y + 8;
    const cols = [
      { t: "Campaña", w: W * 0.42, a: "left" as const },
      { t: "Enviados", w: W * 0.18, a: "right" as const },
      { t: "Aperturas", w: W * 0.20, a: "right" as const },
      { t: "Respuestas", w: W * 0.20, a: "right" as const },
    ];
    doc.roundedRect(LEFT, y, W, 22, 5).fill(soft);
    let x = LEFT + 10;
    doc.fontSize(8.5).font("Helvetica-Bold").fillColor(dim);
    cols.forEach((c) => { doc.text(c.t.toUpperCase(), x, y + 7, { width: c.w - 12, align: c.a }); x += c.w; });
    y += 24;

    const rows = opts.campaigns.length ? opts.campaigns : [{ name: "(sin campañas)", stats: { sent: 0, opens: 0, replies: 0, bounces: 0, clicks: 0, total: 0 } }];
    rows.forEach((r, ri) => {
      if (y > bottom - 22) { doc.addPage(); y = 56; }
      if (ri % 2 === 1) doc.roundedRect(LEFT, y - 4, W, 22, 4).fill("#fafbfd");
      x = LEFT + 10;
      const cells = [
        r.name,
        r.stats.sent.toLocaleString("es"),
        `${r.stats.opens.toLocaleString("es")} · ${pct(r.stats.opens, r.stats.sent)}`,
        `${r.stats.replies.toLocaleString("es")} · ${pct(r.stats.replies, r.stats.sent)}`,
      ];
      doc.font("Helvetica").fontSize(9.5);
      cells.forEach((cell, ci) => {
        doc.fillColor(ci === 0 ? ink : "#475569").font(ci === 0 ? "Helvetica-Bold" : "Helvetica").text(String(cell), x, y, { width: cols[ci].w - 12, align: cols[ci].a, ellipsis: true });
        x += cols[ci].w;
      });
      y += 22;
    });

    // Pie
    doc.fillColor(dim).fontSize(8).font("Helvetica").text(
      `Generado el ${new Date().toLocaleDateString("es")} · onepulso`,
      LEFT, PH - 36, { width: W, align: "center" }
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
