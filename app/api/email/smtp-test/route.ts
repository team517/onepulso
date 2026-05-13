import { NextResponse } from "next/server";
import net from "net";
import nodemailer from "nodemailer";
import { readEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Race contra un timeout duro — devuelve { ok:false, error:"timeout" } si la promise no resuelve. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | { __timeout: true; ms: number; label: string }> {
  return Promise.race([
    p,
    new Promise<{ __timeout: true; ms: number; label: string }>((resolve) =>
      setTimeout(() => resolve({ __timeout: true, ms, label }), ms)
    ),
  ]);
}

/** TCP probe directo — confirma si Railway puede ABRIR el socket. */
function rawTcpProbe(host: string, port: number, timeoutMs = 8000): Promise<{ ok: boolean; banner?: string; error?: string; ms: number }> {
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
      // Damos 1s para banner SMTP (en 465 no llega plain porque va TLS desde el start)
      setTimeout(() => done({ ok: true, banner: banner.trim() || "(sin banner plain — port TLS)" }), 1000);
    });
    sock.on("data", (chunk) => { banner += chunk.toString("utf-8"); });
    sock.on("timeout", () => done({ ok: false, error: `TCP connect timeout tras ${timeoutMs}ms` }));
    sock.on("error", (err) => done({ ok: false, error: `${(err as any).code || ""} ${err.message}`.trim() }));
    try { sock.connect({ port, host, family: 4 }); } catch (e: any) { done({ ok: false, error: e.message }); }
  });
}

/** Verify rápido — login SMTP con timeouts cortos. */
async function fastVerify(cfg: any, port: number, secure: boolean) {
  const t0 = Date.now();
  const pass = (cfg.smtp_password || "").replace(/\s+/g, "");
  const t = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure,
    auth: { user: cfg.smtp_user, pass },
    connectionTimeout: 8000,
    greetingTimeout: 6000,
    socketTimeout: 10000,
    family: 4,
    tls: { rejectUnauthorized: false },
    name: "onepulso.online",
  });
  try {
    await t.verify();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e: any) {
    return { ok: false, error: `${e.code ? e.code + ": " : ""}${e.message}`, ms: Date.now() - t0 };
  } finally {
    try { t.close(); } catch {}
  }
}

/** Envío real rápido — timeouts cortos para que falle rápido si no funciona. */
async function fastSend(cfg: any, port: number, secure: boolean, to: string, label: string) {
  const t0 = Date.now();
  const pass = (cfg.smtp_password || "").replace(/\s+/g, "");
  const t = nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure,
    auth: { user: cfg.smtp_user, pass },
    connectionTimeout: 12000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    family: 4,
    tls: { rejectUnauthorized: false },
    name: "onepulso.online",
  });
  try {
    const info = await t.sendMail({
      from: cfg.display_name ? `"${cfg.display_name}" <${cfg.email}>` : cfg.email,
      to,
      subject: `[onepulso] SMTP test ${label} · ${new Date().toISOString()}`,
      text: `Test SMTP via ${label} — si lees esto, este puerto/config FUNCIONA.`,
    });
    return { ok: true, messageId: info.messageId, ms: Date.now() - t0, label };
  } catch (e: any) {
    return { ok: false, error: `${e.code ? e.code + ": " : ""}${e.message}`, ms: Date.now() - t0, label };
  } finally {
    try { t.close(); } catch {}
  }
}

/**
 * GET /api/email/smtp-test
 * Ejecuta SECUENCIALMENTE pasos cortos y devuelve resultado parcial si algo se cuelga.
 * Tarda como mucho ~45s en total aunque todo falle.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const toOverride = url.searchParams.get("to");
  const skipSend = url.searchParams.get("nosend") === "1";

  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

  const target = toOverride || cfg.email;
  const host = cfg.smtp_host;
  const results: any = {
    started_at: new Date().toISOString(),
    config: {
      host: cfg.smtp_host,
      port_saved: cfg.smtp_port,
      secure_saved: cfg.smtp_secure,
      user: cfg.smtp_user,
      password_length: (cfg.smtp_password || "").length,
      password_has_spaces: /\s/.test(cfg.smtp_password || ""),
      imap_host: cfg.imap_host,
    },
    target,
    steps: [],
  };

  // ── Paso 1: TCP probe a 465 y 587 (paralelo, máx 8s cada uno)
  const stepStart1 = Date.now();
  const [tcp465, tcp587] = await Promise.all([
    rawTcpProbe(host, 465, 8000),
    rawTcpProbe(host, 587, 8000),
  ]);
  results.tcp_probe = { [`${host}:465`]: tcp465, [`${host}:587`]: tcp587 };
  results.steps.push({ step: "tcp_probe", ms: Date.now() - stepStart1 });

  // ── Paso 2: verify rápido en 465 y 587 (paralelo, máx 10s cada uno)
  const stepStart2 = Date.now();
  const [verify465raw, verify587raw] = await Promise.all([
    withTimeout(fastVerify(cfg, 465, true), 12000, "verify465"),
    withTimeout(fastVerify(cfg, 587, false), 12000, "verify587"),
  ]);
  const verify465 = (verify465raw as any).__timeout ? { ok: false, error: "outer timeout 12s" } : verify465raw;
  const verify587 = (verify587raw as any).__timeout ? { ok: false, error: "outer timeout 12s" } : verify587raw;
  results.smtp_verify = { "465/TLS": verify465, "587/STARTTLS": verify587 };
  results.steps.push({ step: "verify", ms: Date.now() - stepStart2 });

  // ── Paso 3: si verify pasa, envío real (secuencial, primero el que funcione)
  if (!skipSend) {
    const stepStart3 = Date.now();
    const sends: any[] = [];
    if ((verify465 as any).ok) {
      const r = await withTimeout(fastSend(cfg, 465, true, target, "465/TLS"), 18000, "send465");
      sends.push((r as any).__timeout ? { ok: false, error: "outer timeout 18s", label: "465/TLS" } : r);
    } else {
      sends.push({ skipped: true, reason: "verify 465 falló", label: "465/TLS", verify_error: (verify465 as any).error });
    }
    if ((verify587 as any).ok) {
      const r = await withTimeout(fastSend(cfg, 587, false, target, "587/STARTTLS"), 18000, "send587");
      sends.push((r as any).__timeout ? { ok: false, error: "outer timeout 18s", label: "587/STARTTLS" } : r);
    } else {
      sends.push({ skipped: true, reason: "verify 587 falló", label: "587/STARTTLS", verify_error: (verify587 as any).error });
    }
    results.real_sends = sends;
    results.steps.push({ step: "real_sends", ms: Date.now() - stepStart3 });
  } else {
    results.real_sends = "skipped (nosend=1)";
  }

  results.finished_at = new Date().toISOString();
  results.total_ms = results.steps.reduce((a: number, s: any) => a + s.ms, 0);
  results.diagnosis = buildDiagnosis(results);
  return NextResponse.json(results);
}

function buildDiagnosis(r: any): string {
  const p465 = r.tcp_probe?.[`${r.config.host}:465`]?.ok;
  const p587 = r.tcp_probe?.[`${r.config.host}:587`]?.ok;
  const v465 = r.smtp_verify?.["465/TLS"]?.ok;
  const v587 = r.smtp_verify?.["587/STARTTLS"]?.ok;
  const sends = Array.isArray(r.real_sends) ? r.real_sends : [];
  const anySendOk = sends.some((s: any) => s?.ok);
  const allSendsFailed = sends.length > 0 && sends.every((s: any) => !s?.ok && !s?.skipped);

  if (anySendOk) {
    const winning = sends.find((s: any) => s?.ok);
    return `✅ FUNCIONA via ${winning.label} (${winning.ms}ms). Te debe llegar el correo de prueba.`;
  }
  if (!p465 && !p587) {
    return `🚨 BLOQUEO DE RED. Railway no puede abrir socket a Gmail SMTP (465: ${r.tcp_probe[`${r.config.host}:465`].error}, 587: ${r.tcp_probe[`${r.config.host}:587`].error}). SOLUCIÓN: cambiar a un relay SMTP (Resend, Brevo, SendGrid) o pedir IP estática a Railway.`;
  }
  if ((p465 || p587) && !v465 && !v587) {
    const err = r.smtp_verify["465/TLS"]?.error || r.smtp_verify["587/STARTTLS"]?.error;
    return `🔐 TCP abre pero AUTH falla en ambos puertos. App password mala o caducada. Error: ${err}. SOLUCIÓN: regenera app password en https://myaccount.google.com/apppasswords y reconecta.`;
  }
  if ((v465 || v587) && allSendsFailed) {
    return `🤔 Verify pasa pero sendMail FALLA. Gmail acepta auth pero algo bloquea el envío real. Errores: ${sends.map((s: any) => `${s.label}: ${s.error}`).join(" · ")}`;
  }
  return `Diagnóstico ambiguo. tcp465=${p465} tcp587=${p587} verify465=${v465} verify587=${v587}. Errores: ${JSON.stringify(r.smtp_verify)}`;
}
