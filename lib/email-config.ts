import { readJson, writeJson, deleteJson } from "./storage";

const KEY = "email-config";

export type EmailConfig = {
  email: string;
  display_name?: string;
  send_aliases?: string[];
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_password: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_user: string;
  imap_password: string;
  signature_html?: string;
  connected_at: string;
  /** Si está configurado, los envíos se hacen por la API HTTPS de Resend en vez de SMTP directo.
   *  Útil cuando el host (Railway) tiene el egress SMTP bloqueado a Gmail. */
  resend_api_key?: string;
  /** Dirección "from" verificada en Resend (necesita dominio verificado allí). Si no se setea, usa cfg.email. */
  resend_from?: string;
};

export async function readEmailConfig(): Promise<EmailConfig | null> {
  return await readJson<EmailConfig>(KEY);
}

export async function saveEmailConfig(c: EmailConfig) {
  await writeJson(KEY, c);
}

export async function clearEmailConfig() {
  await deleteJson(KEY);
}

/** Defaults SMTP/IMAP para cuentas Gmail (con app password) */
export function gmailDefaults(email: string) {
  return {
    smtp_host: "smtp.gmail.com",
    smtp_port: 465,
    smtp_secure: true,
    smtp_user: email,
    imap_host: "imap.gmail.com",
    imap_port: 993,
    imap_secure: true,
    imap_user: email,
  };
}
