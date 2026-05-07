import { NextRequest, NextResponse } from "next/server";
import { readEmailConfig, saveEmailConfig, clearEmailConfig, gmailDefaults } from "@/lib/email-config";
import { verifySmtp } from "@/lib/email-send";
import { verifyImap } from "@/lib/email-inbox";
import { startEmailScheduler } from "@/lib/email-scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

// Arranca scheduler de emails al cargar este módulo (ping al cargar /seguimientos)
startEmailScheduler();

function mask(s: string | undefined) {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return s.slice(0, 3) + "•".repeat(Math.max(s.length - 6, 4)) + s.slice(-3);
}

export async function GET() {
  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    email: cfg.email,
    display_name: cfg.display_name,
    send_aliases: cfg.send_aliases ?? [],
    smtp_host: cfg.smtp_host,
    smtp_port: cfg.smtp_port,
    imap_host: cfg.imap_host,
    imap_port: cfg.imap_port,
    smtp_password_masked: mask(cfg.smtp_password),
    signature_html: cfg.signature_html,
    connected_at: cfg.connected_at,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, app_password, display_name, signature_html, provider, send_aliases } = body;

  // Si solo viene send_aliases sin app_password → patch update sobre config existente
  if (!app_password && Array.isArray(send_aliases)) {
    const cur = await readEmailConfig();
    if (!cur) return NextResponse.json({ error: "No hay config conectada" }, { status: 400 });
    const updated = { ...cur, send_aliases: send_aliases.filter((a: any) => typeof a === "string" && a.includes("@")) };
    await saveEmailConfig(updated);
    return NextResponse.json({ saved: true, send_aliases: updated.send_aliases });
  }

  if (!email || !app_password) {
    return NextResponse.json({ error: "email y app_password requeridos" }, { status: 400 });
  }
  const isGmail = (provider ?? "gmail") === "gmail" || /@gmail\.com$/i.test(email);
  let cfg: any;
  if (isGmail) {
    cfg = {
      email,
      display_name,
      ...gmailDefaults(email),
      smtp_password: app_password,
      imap_password: app_password,
      signature_html,
      connected_at: new Date().toISOString(),
    };
  } else {
    // outlook/office365
    cfg = {
      email,
      display_name,
      smtp_host: "smtp.office365.com",
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: email,
      smtp_password: app_password,
      imap_host: "outlook.office365.com",
      imap_port: 993,
      imap_secure: true,
      imap_user: email,
      imap_password: app_password,
      signature_html,
      connected_at: new Date().toISOString(),
    };
  }
  await saveEmailConfig(cfg);
  // Test
  const [smtp, imap] = await Promise.all([verifySmtp(), verifyImap()]);
  return NextResponse.json({
    saved: true,
    smtp_ok: smtp.ok,
    smtp_error: smtp.error,
    imap_ok: imap.ok,
    imap_error: imap.error,
  });
}

export async function DELETE() {
  await clearEmailConfig();
  return NextResponse.json({ ok: true });
}
