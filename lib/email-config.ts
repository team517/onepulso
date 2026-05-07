import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "email-config.json");

export type EmailConfig = {
  email: string;
  display_name?: string;
  send_aliases?: string[]; // otros emails desde los que el usuario envía (Gmail aliases / Send-As)
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean; // true for 465, false for 587
  smtp_user: string;
  smtp_password: string;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  imap_user: string;
  imap_password: string;
  signature_html?: string;
  connected_at: string;
};

export async function readEmailConfig(): Promise<EmailConfig | null> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {
    return null;
  }
}

export async function saveEmailConfig(c: EmailConfig) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(c, null, 2), "utf-8");
}

export async function clearEmailConfig() {
  await fs.unlink(FILE).catch(() => {});
}

/**
 * Defaults para Gmail con app password.
 * Para Outlook/Office 365: smtp.office365.com:587 (STARTTLS), outlook.office365.com:993
 */
export function gmailDefaults(email: string): Partial<EmailConfig> {
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
