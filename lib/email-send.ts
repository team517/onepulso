import nodemailer from "nodemailer";
import { promises as fs } from "fs";
import { ImapFlow } from "imapflow";
import { readEmailConfig } from "./email-config";

export type SendInput = {
  to: string | string[];
  subject: string;
  body_html: string;
  attachments?: Array<{ filename: string; path: string }>;
  in_reply_to?: string; // Message-ID for threading
  references?: string[];
};

export async function sendEmail(input: SendInput): Promise<{ messageId: string; envelope: any }> {
  const cfg = await readEmailConfig();
  if (!cfg) throw new Error("Email no conectado. Configura tu cuenta primero.");

  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_secure,
    auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
  });

  let html = input.body_html;
  if (cfg.signature_html) {
    html += `<br><br>${cfg.signature_html}`;
  }

  const info = await transporter.sendMail({
    from: cfg.display_name ? `"${cfg.display_name}" <${cfg.email}>` : cfg.email,
    to: input.to,
    subject: input.subject,
    html,
    attachments: input.attachments,
    inReplyTo: input.in_reply_to,
    references: input.references,
  });

  // Subir copia a la carpeta Sent vía IMAP (Gmail no lo hace solo cuando envías por SMTP de terceros).
  // Para Gmail funciona OK porque Gmail asocia automáticamente lo enviado al thread por Message-ID.
  // De todas formas, lo subimos para que aparezca en "Enviados" de inmediato.
  try {
    const raw = (info as any).message ?? "";
    if (raw) {
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
      // Para no-Gmail SÍ appendeamos.
      if (!isGmail && sentPath) {
        await client.append(sentPath, raw, ["\\Seen"]);
      }
      await client.logout();
    }
  } catch (e) {
    // Silencioso: si falla el append no rompe el envío
    console.warn("[email-send] no pude appendear a Sent:", (e as any)?.message);
  }

  return { messageId: info.messageId, envelope: info.envelope };
}

export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await readEmailConfig();
  if (!cfg) return { ok: false, error: "no config" };
  try {
    const t = nodemailer.createTransport({
      host: cfg.smtp_host,
      port: cfg.smtp_port,
      secure: cfg.smtp_secure,
      auth: { user: cfg.smtp_user, pass: cfg.smtp_password },
    });
    await t.verify();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
