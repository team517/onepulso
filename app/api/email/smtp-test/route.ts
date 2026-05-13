import { NextResponse } from "next/server";
import net from "net";
import { readEmailConfig } from "@/lib/email-config";
import { verifySmtp } from "@/lib/email-send";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Test TCP raw a un puerto SMTP — confirma si Railway puede ABRIR el socket */
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
      // En 465 el banner es TLS-encrypted → no lo veremos plain. Pero el connect en sí ya prueba conectividad.
      // Si es 587, esperamos a recibir banner unos ms.
      setTimeout(() => done({ ok: true, banner: banner.trim() || "(connected, no plain banner — probablemente TLS port)" }), 1500);
    });
    sock.on("data", (chunk) => { banner += chunk.toString("utf-8"); });
    sock.on("timeout", () => done({ ok: false, error: `TCP connect timeout tras ${timeoutMs}ms` }));
    sock.on("error", (err) => done({ ok: false, error: `${(err as any).code || ""} ${err.message}`.trim() }));

    try {
      sock.connect(port, host);
    } catch (e: any) {
      done({ ok: false, error: e.message });
    }
  });
}

/**
 * GET /api/email/smtp-test
 * Diagnóstico de conectividad SMTP desde el servidor (Railway).
 * Devuelve:
 *  - config actual
 *  - TCP probe a 465 y 587 de tu smtp_host (¿se abre el socket?)
 *  - verifySmtp() (¿podemos hacer login real?)
 */
export async function GET() {
  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

  const host = cfg.smtp_host;
  const [tcp465, tcp587, verifyResult] = await Promise.all([
    rawTcpProbe(host, 465, 10000),
    rawTcpProbe(host, 587, 10000),
    verifySmtp().catch((e) => ({ ok: false, error: e.message })),
  ]);

  return NextResponse.json({
    config: {
      host: cfg.smtp_host,
      port: cfg.smtp_port,
      secure: cfg.smtp_secure,
      user: cfg.smtp_user,
      password_length: (cfg.smtp_password || "").length,
      password_has_spaces: /\s/.test(cfg.smtp_password || ""),
    },
    tcp_probe: {
      [`${host}:465`]: tcp465,
      [`${host}:587`]: tcp587,
    },
    smtp_verify: verifyResult,
    diagnosis: diagnose(tcp465, tcp587, verifyResult),
  });
}

function diagnose(tcp465: any, tcp587: any, verify: any): string {
  if (verify.ok) return `✅ SMTP OK via ${verify.via}. Si los envíos fallan es por otro motivo (revisa logs de la función sendEmail).`;
  if (!tcp465.ok && !tcp587.ok) return `🚨 BLOQUEO DE RED: Railway no puede abrir socket a ${tcp465.error || tcp587.error}. Probablemente el egress de Railway está bloqueado por Gmail. Soluciones: (1) usar una IP fija de Railway, (2) cambiar a un relay SMTP como Resend/Brevo, (3) probar OAuth2 con Gmail API.`;
  if (tcp465.ok && tcp587.ok) return `🔐 TCP funciona pero AUTH falla: probablemente la app password está mal o caducó. Genera una nueva en https://myaccount.google.com/apppasswords y reconecta. Error: ${verify.error}`;
  if (tcp465.ok && !tcp587.ok) return `Puerto 587 bloqueado, 465 abierto. Asegúrate que la config usa 465/TLS.`;
  return `Diagnóstico ambiguo. Error: ${verify.error}`;
}
