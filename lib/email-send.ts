import nodemailer from "nodemailer";
import { ImapFlow } from "imapflow";
import { readEmailConfig, type EmailConfig } from "./email-config";
import { promises as fs } from "fs";

export type SendInput = {
  to: string | string[];
  subject: string;
  body_html: string;
  attachments?: Array<{ filename: string; path: string }>;
  in_reply_to?: string; // Message-ID for threading
  references?: string[];
};

/**
 * Envío via Resend HTTPS API (https://resend.com).
 * Se usa cuando el host bloquea SMTP saliente — Resend va por HTTPS 443
 * que Railway nunca bloquea.
 */
async function sendViaResend(cfg: EmailConfig, input: SendInput): Promise<{ messageId: string; envelope: any; via: "resend" }> {
  const apiKey = cfg.resend_api_key!;
  const fromAddr = cfg.resend_from || cfg.email;
  const from = cfg.display_name ? `${cfg.display_name} <${fromAddr}>` : fromAddr;

  let html = input.body_html;
  if (cfg.signature_html) html += `<br><br>${cfg.signature_html}`;

  // Cabeceras para threading — Resend las soporta vía el parámetro 'headers'
  const headers: Record<string, string> = {};
  if (input.in_reply_to) headers["In-Reply-To"] = input.in_reply_to;
  if (input.references && input.references.length > 0) headers["References"] = input.references.join(" ");
  // Reply-To: respondemos siempre a la cuenta real (cfg.email), no a la del dominio Resend
  if (cfg.email && cfg.email !== fromAddr) headers["Reply-To"] = cfg.email;

  // Attachments: Resend acepta { filename, content } donde content es base64 o url
  let attachments: Array<{ filename: string; content: string }> | undefined;
  if (input.attachments && input.attachments.length > 0) {
    attachments = await Promise.all(
      input.attachments.map(async (a) => ({
        filename: a.filename,
        content: (await fs.readFile(a.path)).toString("base64"),
      }))
    );
  }

  const body = {
    from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    html,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    attachments,
  };

  const t0 = Date.now();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.message || json?.error || JSON.stringify(json);
    throw new Error(`Resend API ${res.status}: ${detail}`);
  }
  console.log(`[email-send] OK via Resend → id=${json.id} (${Date.now() - t0}ms)`);
  // Resend devuelve { id: 'uuid' }. Lo usamos como messageId.
  return {
    messageId: `<${json.id}@resend.dev>`,
    envelope: { from: fromAddr, to: body.to },
    via: "resend",
  };
}

/** Construye un transporter con timeouts explícitos y opcionalmente puerto/secure custom.
 *  Railway a veces tiene latencia o bloqueos transitorios → necesitamos timeouts y poder
 *  hacer fallback de 465 (SMTPS) a 587 (STARTTLS) sin tocar la config guardada. */
function buildTransporter(cfg: EmailConfig, overrides?: { port?: number; secure?: boolean }) {
  const port = overrides?.port ?? cfg.smtp_port;
  const secure = overrides?.secure ?? cfg.smtp_secure;
  // Gmail app passwords vienen como "xxxx xxxx xxxx xxxx" — los espacios rompen el auth si no se quitan
  const pass = (cfg.smtp_password || "").replace(/\s+/g, "");
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port,
    secure,
    auth: { user: cfg.smtp_user, pass },
    // Timeouts generosos — Railway a veces tarda en establecer conexión a Gmail
    connectionTimeout: 60000,  // 60s para abrir el socket TCP
    greetingTimeout: 30000,    // 30s para recibir el banner SMTP
    socketTimeout: 90000,      // 90s sin actividad → cierra
    // TLS permisivo: dejamos que nodemailer decida y aceptamos certs incluso si hay proxy intermedio
    tls: { rejectUnauthorized: false },
  });
}

function isTransientError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  const code = String(err?.code || "").toUpperCase();
  return (
    msg.includes("timeout") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("network") ||
    msg.includes("eai_again") ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ESOCKET" ||
    code === "EDNS"
  );
}

async function trySend(
  cfg: EmailConfig,
  mailOptions: nodemailer.SendMailOptions,
  overrides?: { port?: number; secure?: boolean; label?: string }
) {
  const label = overrides?.label ?? `${overrides?.port ?? cfg.smtp_port}/${(overrides?.secure ?? cfg.smtp_secure) ? "TLS" : "STARTTLS"}`;
  const t = buildTransporter(cfg, overrides);
  try {
    const info = await t.sendMail(mailOptions);
    console.log(`[email-send] OK via ${label} → messageId=${info.messageId}`);
    return info;
  } finally {
    try { t.close(); } catch {}
  }
}

export async function sendEmail(input: SendInput): Promise<{ messageId: string; envelope: any }> {
  const cfg = await readEmailConfig();
  if (!cfg) throw new Error("Email no conectado. Configura tu cuenta primero.");

  // Si hay Resend configurado, lo preferimos (egress HTTPS, nunca bloqueado por Railway)
  if (cfg.resend_api_key) {
    return await sendViaResend(cfg, input);
  }

  let html = input.body_html;
  if (cfg.signature_html) {
    html += `<br><br>${cfg.signature_html}`;
  }

  const mailOptions: nodemailer.SendMailOptions = {
    from: cfg.display_name ? `"${cfg.display_name}" <${cfg.email}>` : cfg.email,
    to: input.to,
    subject: input.subject,
    html,
    attachments: input.attachments,
    inReplyTo: input.in_reply_to,
    references: input.references,
  };

  // Estrategia: hasta 3 intentos.
  //   1) Config tal cual (típicamente Gmail 465/SMTPS)
  //   2) Reintento mismo config tras backoff (errores de red transitorios)
  //   3) Fallback a 587/STARTTLS (Gmail acepta ambos; algunos hosts bloquean 465)
  const attempts: Array<{ port?: number; secure?: boolean; label: string; wait: number }> = [
    { label: `${cfg.smtp_port}/${cfg.smtp_secure ? "TLS" : "STARTTLS"}`, wait: 0 },
    { label: `${cfg.smtp_port}/${cfg.smtp_secure ? "TLS" : "STARTTLS"} (retry)`, wait: 2000 },
  ];
  // Sólo añadimos fallback si la config inicial no es ya 587
  if (cfg.smtp_port !== 587) {
    attempts.push({ port: 587, secure: false, label: "587/STARTTLS (fallback)", wait: 1500 });
  } else {
    attempts.push({ port: 465, secure: true, label: "465/TLS (fallback)", wait: 1500 });
  }

  const errorTrail: string[] = [];
  let info: any = null;
  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (a.wait > 0) await new Promise((r) => setTimeout(r, a.wait));
    try {
      info = await trySend(cfg, mailOptions, { port: a.port, secure: a.secure, label: a.label });
      break;
    } catch (e: any) {
      const trace = `[${a.label}] ${e.code ? e.code + ": " : ""}${e.message}`;
      errorTrail.push(trace);
      console.warn(`[email-send] intento ${i + 1}/${attempts.length} via ${a.label} falló: ${e.message} (code=${e.code})`);
      // Si no es un error de red, no tiene sentido reintentar (p.ej. auth fail)
      if (!isTransientError(e)) {
        // Si aún tenemos fallback de puerto, lo dejamos seguir.
        if (i < attempts.length - 1 && attempts[i + 1]?.port !== undefined && a.port === undefined) continue;
        throw new Error(errorTrail.join(" · "));
      }
    }
  }
  if (!info) {
    // Todos los intentos fallaron — lanzamos un error compuesto con el detalle
    throw new Error(`SMTP falló en ${attempts.length} intentos. ${errorTrail.join(" · ")}`);
  }

  // Subir copia a la carpeta Sent vía IMAP — opcional y CON TIMEOUT DURO.
  // No queremos que un IMAP lento bloquee la respuesta al usuario (el envío SMTP ya fue OK).
  try {
    const raw = (info as any).message ?? "";
    if (raw) {
      await Promise.race([
        (async () => {
          const client = new ImapFlow({
            host: cfg.imap_host,
            port: cfg.imap_port,
            secure: cfg.imap_secure,
            auth: { user: cfg.imap_user, pass: cfg.imap_password },
            logger: false,
          });
          await client.connect();
          const list = (await client.list()) as any[];
          const isGmail = list.some((m: any) => m.path.startsWith("[Gmail]") || m.path.startsWith("[Google Mail]"));
          let sentPath: string | undefined;
          for (const m of list) {
            const flags: string[] = m.specialUse ? [m.specialUse] : (m.flags ?? []);
            if (flags.includes("\\Sent") || /\bSent\b|\bEnviados\b|\bGesendet\b/i.test(m.path)) {
              if (!sentPath) sentPath = m.path;
            }
          }
          // Para Gmail NO appendeamos a Sent — Gmail lo crea solo cuando el From coincide con el usuario auth.
          if (!isGmail && sentPath) {
            await client.append(sentPath, raw, ["\\Seen"]);
          }
          await client.logout();
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP append timeout (20s)")), 20000)),
      ]);
    }
  } catch (e) {
    // Silencioso: si falla el append no rompe el envío
    console.warn("[email-send] no pude appendear a Sent:", (e as any)?.message);
  }

  return { messageId: info.messageId, envelope: info.envelope };
}

export async function verifySmtp(): Promise<{ ok: boolean; error?: string; via?: string }> {
  const cfg = await readEmailConfig();
  if (!cfg) return { ok: false, error: "no config" };

  // Probar primero la config guardada
  try {
    const t = buildTransporter(cfg);
    await t.verify();
    try { t.close(); } catch {}
    return { ok: true, via: `${cfg.smtp_port}/${cfg.smtp_secure ? "TLS" : "STARTTLS"}` };
  } catch (e: any) {
    const firstErr = e.message;
    // Fallback: probar el puerto alternativo (465 ↔ 587)
    const altPort = cfg.smtp_port === 587 ? 465 : 587;
    const altSecure = altPort === 465;
    try {
      const t2 = buildTransporter(cfg, { port: altPort, secure: altSecure });
      await t2.verify();
      try { t2.close(); } catch {}
      return { ok: true, via: `${altPort}/${altSecure ? "TLS" : "STARTTLS"} (fallback)` };
    } catch (e2: any) {
      return { ok: false, error: `Primary: ${firstErr} · Fallback ${altPort}: ${e2.message}` };
    }
  }
}
