import { NextResponse } from "next/server";
import net from "net";
import nodemailer from "nodemailer";
import { readEmailConfig } from "@/lib/email-config";
import { sendEmail, verifySmtp } from "@/lib/email-send";

export const runtime = "nodejs";
export const maxDuration = 120;

/** TCP probe directo — confirma si Railway puede ABRIR el socket. */
function rawTcpProbe(host: string, port: number, timeoutMs = 10000): Promise<{ ok: boolean; banner?: string; error?: string; ms: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const sock = new net.Socket();
    let resolved = false;
    let banner = "";
    const done = (result: any) => {
      if (resolved) return;
      resolved = true;
      try { sock.destroy(); } catch {}
      resolve({ ...result, ms: Date.now() - t0 });
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => {
      setTimeout(() => done({ ok: true, banner: banner.trim() || "(connected, no plain banner — probablemente TLS port)" }), 1500);
    });
    sock.on("data", (chunk) => { banner += chunk.toString("utf-8"); });
    sock.on("timeout", () => done({ ok: false, error: `TCP connect timeout tras ${timeoutMs}ms` }));
    sock.on("error", (err) => done({ ok: false, error: `${(err as any).code || ""} ${err.message}`.trim() }));
    try { sock.connect(port, host); } catch (e: any) { done({ ok: false, error: e.message }); }
  });
}

/** Envío bare-bones (sin retry, sin timeouts custom, sin tls custom) — replica el código ORIGINAL pre-cambios. */
async function bareBoneSend(cfg: any, to: string) {
  const t0 = Date.now();
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port,
      secure: cfg.smtp_secure,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
    });
    const info = await transporter.sendMail({
      from: cfg.display_name ? `"${cfg.display_name}" <${cfg.email}>` : cfg.email,
      to,
      subject: "[onepulso] SMTP test bare-bones · " + new Date().toISOString(),
      text: "Este es un test de SMTP enviado desde /api/email/smtp-test (bare-bones config).",
    });
    return { ok: true, messageId: info.messageId, ms: Date.now() - t0, config: `${cfg.smtp_port}/${cfg.smtp_secure ? "TLS" : "STARTTLS"}` };
  } catch (e: any) {
    return { ok: false, error: `${e.code ? e.code + ": " : ""}${e.message}`, ms: Date.now() - t0 };
  }
}

/** Envío con la lib actual (retry + fallback). */
async function libSend(to: string) {
  const t0 = Date.now();
  try {
    const r = await sendEmail({
      to,
      subject: "[onepulso] SMTP test via lib · " + new Date().toISOString(),
      body_html: "<p>Test SMTP enviado desde /api/email/smtp-test (via lib sendEmail con retry/fallback).</p>",
    });
    return { ok: true, messageId: r.messageId, ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, error: e.message, ms: Date.now() - t0 };
  }
}

/**
 * GET /api/email/smtp-test
 *   - Diagnóstico completo: config, TCP probe, verify, bare-bones send, lib send
 *   - Envía 2 correos de prueba a tu propia cuenta (te llegarán al inbox)
 *
 * GET /api/email/smtp-test?probe=1
 *   - Solo TCP probe + verify, sin envíos reales
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const probeOnly = url.searchParams.get("probe") === "1";
  const toOverride = url.searchParams.get("to");

  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

  const target = toOverride || cfg.email; // por defecto envía a ti mismo
  const host = cfg.smtp_host;

  // Fase 1: TCP probes (rápido — 10s timeout máx por puerto)
  const [tcp465, tcp587] = await Promise.all([
    rawTcpProbe(host, 465, 10000),
    rawTcpProbe(host, 587, 10000),
  ]);

  // Fase 2: verifySmtp (login real, sin enviar)
  const verifyResult = await verifySmtp().catch((e) => ({ ok: false, error: e.message }));

  if (probeOnly) {
    return NextResponse.json({
      mode: "probe-only",
      config: configSummary(cfg),
      tcp_probe: { [`${host}:465`]: tcp465, [`${host}:587`]: tcp587 },
      smtp_verify: verifyResult,
      diagnosis: diagnose(tcp465, tcp587, verifyResult),
    });
  }

  // Fase 3: envíos reales (uno bare-bones, otro via lib)
  const [bare, lib] = await Promise.all([
    bareBoneSend(cfg, target),
    libSend(target),
  ]);

  return NextResponse.json({
    mode: "full-test",
    config: configSummary(cfg),
    target,
    tcp_probe: { [`${host}:465`]: tcp465, [`${host}:587`]: tcp587 },
    smtp_verify: verifyResult,
    bare_bones_send: bare,
    lib_send: lib,
    diagnosis: diagnose(tcp465, tcp587, verifyResult, bare, lib),
  });
}

function configSummary(cfg: any) {
  return {
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_secure,
    user: cfg.smtp_user,
    password_length: (cfg.smtp_password || "").length,
    password_first_2: (cfg.smtp_password || "").slice(0, 2) + "***",
    password_has_spaces: /\s/.test(cfg.smtp_password || ""),
    password_has_special_chars: /[^a-zA-Z0-9 ]/.test(cfg.smtp_password || ""),
  };
}

function diagnose(tcp465: any, tcp587: any, verify: any, bare?: any, lib?: any): string {
  // Casos primarios
  if (!tcp465.ok && !tcp587.ok) {
    return `🚨 BLOQUEO DE RED: Railway no abre socket a Gmail (465: ${tcp465.error}, 587: ${tcp587.error}). Solución: usar relay SMTP (Resend / Brevo / SendGrid) o IP estática.`;
  }
  if (verify.ok === false && tcp465.ok && tcp587.ok) {
    return `🔐 TCP funciona pero AUTH falla. App password mala/caducada. Error: ${verify.error}. Solución: regenera app password en https://myaccount.google.com/apppasswords y reconecta.`;
  }
  // Si tenemos resultados de envío reales
  if (bare && lib) {
    if (bare.ok && lib.ok) return `✅ TODO FUNCIONA. Bare-bones y lib mandaron mensajes (messageIds ${bare.messageId}, ${lib.messageId}). Si los follow-ups fallan, mira los logs específicos.`;
    if (bare.ok && !lib.ok) return `⚠️ Bare-bones OK pero lib falla. El problema está en la lib sendEmail (retry/fallback/IMAP append). Error lib: ${lib.error}`;
    if (!bare.ok && lib.ok) return `🤔 Lib OK pero bare-bones falla (raro). Error bare: ${bare.error}`;
    if (!bare.ok && !lib.ok) return `❌ AMBOS fallan en envío real aunque verify pase. Bare: ${bare.error} · Lib: ${lib.error}`;
  }
  if (verify.ok) return `✅ verify pasa via ${verify.via}. Pulsa con ?probe=0 (default) para envío real.`;
  return `Diagnóstico ambiguo. tcp465.ok=${tcp465.ok}, tcp587.ok=${tcp587.ok}, verify.ok=${verify.ok}`;
}
