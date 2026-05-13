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
 *
 * Tras enviar por Resend, hacemos IMAP append del MIME a la carpeta "Enviados"
 * de la cuenta del usuario, para que el correo aparezca en su Gmail "Enviados"
 * (Resend no lo hace porque el SMTP de Gmail no participa en el envío).
 */
async function sendViaResend(cfg: EmailConfig, input: SendInput): Promise<{ messageId: string; envelope: any; via: "resend"; message?: Buffer }> {
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

  // Generamos un Message-ID consistente para que aparezca igual en Resend, en el
  // inbox del destinatario y en la copia que appendamos a "Enviados" del usuario.
  const domain = (cfg.email.split("@")[1] || "onepulso.local").toLowerCase();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 14)}@${domain}>`;
  headers["Message-ID"] = messageId;

  // Construir el MIME completo con MailComposer (mismo motor que usa nodemailer)
  // — luego este buffer es el que enviamos a Resend (vía html/headers) Y el que
  // appendamos a IMAP Sent. Así Resend, destinatario y nuestra copia local
  // tienen exactamente el mismo Message-ID y headers.
  const MailComposerMod = await import("nodemailer/lib/mail-composer");
  const MailComposer: any = (MailComposerMod as any).default || MailComposerMod;
  const mimeBuffer: Buffer = await new Promise((resolve, reject) => {
    const mc = new MailComposer({
      from,
      to: input.to,
      subject: input.subject,
      html,
      inReplyTo: input.in_reply_to,
      references: input.references,
      messageId,
      headers: cfg.email && cfg.email !== fromAddr ? { "Reply-To": cfg.email } : undefined,
      attachments: input.attachments,
    });
    mc.compile().build((err: any, buf: Buffer) => (err ? reject(err) : resolve(buf)));
  });

  // Attachments: Resend acepta { filename, content } donde content es base64
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
    headers,
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
  console.log(`[email-send] OK via Resend → resend_id=${json.id} message_id=${messageId} (${Date.now() - t0}ms)`);

  return {
    messageId,
    envelope: { from: fromAddr, to: body.to },
    via: "resend",
    message: mimeBuffer, // se reutiliza en el bloque IMAP append de sendEmail
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
    connectionTimeout: 30000,
    greetingTimeout: 20000,
    socketTimeout: 45000,
    // Forzar IPv4: el routing IPv6 de algunos hosts a Gmail está roto/bloqueado
    family: 4,
    tls: { rejectUnauthorized: false },
    // Nombre EHLO — algunos filtros antispam de Gmail evalúan el hostname presentado
    name: "onepulso.online",
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

/**
 * Sube una copia del email enviado a la carpeta "Enviados" del IMAP del usuario.
 * - Si via=resend, SIEMPRE intentamos appendear (incluso Gmail), porque Gmail
 *   no ve el outgoing al ir via Resend HTTPS.
 * - Si via=smtp, sólo appendamos en NO-Gmail (Gmail lo hace solo al enviar por su SMTP).
 *
 * Silencioso: si falla, sólo loguea — no rompe el envío.
 */
async function appendToImapSent(cfg: EmailConfig, rawMime: Buffer | string, opts: { forceEvenIfGmail: boolean }) {
  try {
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
        try {
          const list = (await client.list()) as any[];
          const isGmail = list.some((m: any) => m.path.startsWith("[Gmail]") || m.path.startsWith("[Google Mail]"));

          // Buscar la carpeta Sent — preferir specialUse=\Sent, luego nombre conocido en varios idiomas
          let sentPath: string | undefined;
          for (const m of list) {
            if (m.specialUse === "\\Sent") { sentPath = m.path; break; }
          }
          if (!sentPath) {
            for (const m of list) {
              const flags: string[] = m.flags ?? [];
              if (flags.includes("\\Sent") || /\b(Sent\s?Mail|Sent|Enviados|Gesendet|Verzonden|Inviata|Envoyés|Envoyes)\b/i.test(m.path)) {
                sentPath = m.path; break;
              }
            }
          }
          // Fallback típico Gmail
          if (!sentPath && isGmail) sentPath = "[Gmail]/Sent Mail";

          if (sentPath && (!isGmail || opts.forceEvenIfGmail)) {
            await client.append(sentPath, rawMime, ["\\Seen"]);
            console.log(`[email-send] IMAP append → ${sentPath}`);
          }
        } finally {
          try { await client.logout(); } catch {}
        }
      })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("IMAP append timeout (20s)")), 20000)),
    ]);
  } catch (e) {
    console.warn("[email-send] no pude appendear a Sent:", (e as any)?.message);
  }
}

export async function sendEmail(input: SendInput): Promise<{ messageId: string; envelope: any }> {
  const cfg = await readEmailConfig();
  if (!cfg) throw new Error("Email no conectado. Configura tu cuenta primero.");

  // Si hay Resend configurado, lo preferimos (egress HTTPS, nunca bloqueado por Railway)
  if (cfg.resend_api_key) {
    const r = await sendViaResend(cfg, input);
    // IMPORTANTE: como Gmail no participa en este envío, hay que appendear
    // manualmente a "Enviados" para que el usuario vea el mensaje en su Gmail.
    if (r.message) {
      await appendToImapSent(cfg, r.message, { forceEvenIfGmail: true });
    }
    return { messageId: r.messageId, envelope: r.envelope };
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

  // Subir copia a la carpeta Sent vía IMAP — pero NO para Gmail (Gmail lo hace solo
  // cuando se envía por su propio SMTP). Para otros IMAP sí appendamos.
  const raw = (info as any).message ?? "";
  if (raw) {
    await appendToImapSent(cfg, raw, { forceEvenIfGmail: false });
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
