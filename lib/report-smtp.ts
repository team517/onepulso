/**
 * Cuenta SMTP DEDICADA para el envío de los informes de clientes.
 *
 * Es independiente de la cuenta de "Seguimientos": el usuario conecta aquí un
 * SMTP (host/puerto/usuario/contraseña) y los informes se envían por él. Si no
 * hay SMTP configurado, `sendReportForClient` cae a la cuenta de Seguimientos.
 *
 * La contraseña la introduce el usuario en la UI; se guarda en kv `report-smtp`
 * (igual que el resto de credenciales de la plataforma).
 */
import nodemailer from "nodemailer";
import { readJson, writeJson } from "./storage";

const KEY = "report-smtp";

export type ReportSmtp = {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from_email?: string;
  from_name?: string;
};

export async function getReportSmtp(): Promise<ReportSmtp> {
  return (await readJson<ReportSmtp>(KEY)) ?? {};
}

/** Guarda la config. Si `pass` viene vacío, NO se pisa la contraseña existente
 *  (para poder reeditar host/from sin volver a teclear la contraseña). */
export async function saveReportSmtp(patch: Partial<ReportSmtp>): Promise<ReportSmtp> {
  const cur = await getReportSmtp();
  const next: ReportSmtp = { ...cur, ...patch };
  if (!patch.pass) next.pass = cur.pass;
  await writeJson(KEY, next);
  return next;
}

export function isReportSmtpConfigured(s: ReportSmtp): boolean {
  return !!(s.host && s.user && s.pass);
}

function makeTransport(s: ReportSmtp) {
  const port = s.port || 587;
  const secure = port === 465; // 465 = SSL directo; 587/25 = STARTTLS
  return nodemailer.createTransport({
    host: s.host,
    port,
    secure,
    auth: { user: s.user, pass: (s.pass || "").replace(/\s+/g, "") },
    requireTLS: !secure && port === 587,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    tls: { rejectUnauthorized: false },
  } as any);
}

/** Verifica que las credenciales SMTP conectan (login OK). */
export async function testReportSmtp(s: ReportSmtp): Promise<{ ok: boolean; error?: string }> {
  if (!s.host || !s.user || !s.pass) return { ok: false, error: "Faltan host, usuario o contraseña." };
  try {
    const t = makeTransport(s);
    try { await t.verify(); } finally { try { t.close(); } catch {} }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/** Envía un correo por la cuenta SMTP de informes (con reintento 587↔465). */
export async function sendViaReportSmtp(
  s: ReportSmtp,
  input: { to: string; subject: string; html: string }
): Promise<{ messageId: string }> {
  const fromEmail = s.from_email || s.user!;
  const from = s.from_name ? `"${s.from_name}" <${fromEmail}>` : fromEmail;
  const text = input.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const primary = s.port || 587;
  const alt = primary === 587 ? 465 : 587;

  let lastErr: any = null;
  for (const port of [primary, alt]) {
    const t = makeTransport({ ...s, port });
    try {
      const info = await t.sendMail({ from, to: input.to, subject: input.subject, html: input.html, text });
      try { t.close(); } catch {}
      return { messageId: info.messageId };
    } catch (e: any) {
      lastErr = e;
      try { t.close(); } catch {}
      const msg = String(e?.message || e).toLowerCase();
      const conn = /timeout|econnrefused|etimedout|greeting|econnreset|socket|connection/.test(msg);
      if (!conn) break; // error de auth → no probar el puerto alternativo
    }
  }
  throw new Error(lastErr?.message || "No se pudo enviar por SMTP.");
}
