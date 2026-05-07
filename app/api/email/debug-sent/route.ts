import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
  });

  const results: any[] = [];
  try {
    await client.connect();
    const list = (await client.list()) as any[];
    let sentPath: string | undefined;
    for (const m of list) {
      if (m.specialUse === "\\Sent" || /\bEnviados\b|\bSent\b/i.test(m.path ?? "")) {
        sentPath = m.path;
        break;
      }
    }
    if (!sentPath) {
      await client.logout();
      return NextResponse.json({ error: "No se encontró carpeta Enviados" });
    }

    await client.mailboxOpen(sentPath, { readOnly: true });
    const status = await client.status(sentPath, { messages: true });
    const total = status.messages ?? 0;
    if (total === 0) {
      await client.logout();
      return NextResponse.json({ folder: sentPath, total: 0, recent: [] });
    }

    // Últimos 5 mensajes
    const start = Math.max(1, total - 4);
    for (let seq = start; seq <= total; seq++) {
      try {
        const m = await client.fetchOne(seq.toString(), { source: true, internalDate: true, envelope: true });
        if (!m) continue;
        const env = m.envelope as any;
        let from = env?.from?.[0]?.address ?? (env?.from?.[0]?.mailbox && env?.from?.[0]?.host ? `${env.from[0].mailbox}@${env.from[0].host}` : "");
        let to: string[] = (env?.to ?? []).map((a: any) => a.address ?? (a.mailbox && a.host ? `${a.mailbox}@${a.host}` : "")).filter(Boolean);
        let subject = env?.subject ?? "";
        results.push({
          seq,
          from,
          to,
          subject,
          date: m.internalDate?.toISOString(),
        });
      } catch {
        /* skip */
      }
    }
    await client.logout();
    return NextResponse.json({ folder: sentPath, total, recent: results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
