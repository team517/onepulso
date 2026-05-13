import { NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readEmailConfig } from "@/lib/email-config";
import { listThreads, appendMessage, type Thread } from "@/lib/email-threads";

export const runtime = "nodejs";
export const maxDuration = 90;

/**
 * POST /api/email/sync-thread
 * Body: { thread_id: string, days?: number }
 *
 * Hace un resync AGRESIVO de un hilo concreto:
 *  - Busca en IMAP TODOS los mensajes intercambiados con los participantes del hilo
 *  - Tanto FROM ellos como TO ellos
 *  - En INBOX, Sent, All Mail y Spam
 *  - Adjunta los que falten al hilo (dedup por message_id)
 *
 * Útil cuando una respuesta del contacto no aparece por threading roto.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const threadId = body.thread_id;
  const days = parseInt(body.days || "60", 10);
  if (!threadId) return NextResponse.json({ error: "thread_id requerido" }, { status: 400 });

  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

  const threads = await listThreads();
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return NextResponse.json({ error: "Hilo no encontrado" }, { status: 404 });

  const ownEmails = new Set<string>([
    cfg.email.toLowerCase(),
    ...((cfg as any).send_aliases ?? []).map((a: string) => String(a).toLowerCase()),
  ]);
  const contactAddrs = thread.participants
    .map((p) => String(p).toLowerCase().trim())
    .filter((p) => p && !ownEmails.has(p));

  if (contactAddrs.length === 0) {
    return NextResponse.json({ error: "El hilo no tiene contactos externos" }, { status: 400 });
  }

  const knownMsgIds = new Set<string>(
    thread.messages.map((m) => normMsgId(m.message_id)).filter(Boolean)
  );

  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
    socketTimeout: 5 * 60 * 1000,
  });

  let added = 0;
  let scanned = 0;
  const errors: string[] = [];

  try {
    await client.connect();
    const folderList = await client.list();
    const folders: string[] = [];
    const inbox = folderList.find((m) => /^inbox$/i.test(m.path));
    if (inbox) folders.push(inbox.path);
    const allMail = folderList.find((m) => m.specialUse === "\\All" || /\[Gmail\]\/(All Mail|Todos)/i.test(m.path));
    if (allMail) folders.push(allMail.path);
    const sent = folderList.find((m) => m.specialUse === "\\Sent" || /\[Gmail\]\/(Sent Mail|Enviados)/i.test(m.path));
    if (sent) folders.push(sent.path);
    const spam = folderList.find((m) => m.specialUse === "\\Junk" || /\[Gmail\]\/(Spam|Correo no deseado)/i.test(m.path));
    if (spam) folders.push(spam.path);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    for (const folder of folders) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const uidsCollected = new Set<number>();
          for (const addr of contactAddrs) {
            try {
              const fromUids = (await client.search({ from: addr, since } as any, { uid: true })) ?? [];
              fromUids.forEach((u) => uidsCollected.add(u));
            } catch {}
            try {
              const toUids = (await client.search({ to: addr, since } as any, { uid: true })) ?? [];
              toUids.forEach((u) => uidsCollected.add(u));
            } catch {}
          }
          const uids = Array.from(uidsCollected);
          for (const uid of uids) {
            scanned++;
            try {
              const full = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
              if (!full) continue;
              const parsed = await simpleParser(full.source as any);
              const messageId = normMsgId(parsed.messageId ?? "");
              if (!messageId || knownMsgIds.has(messageId)) continue;

              const fromAddr = String(parsed.from?.value?.[0]?.address ?? "").toLowerCase();
              const toAddrsRaw = (parsed.to as any)?.value ?? [];
              const toAddrs = (Array.isArray(toAddrsRaw) ? toAddrsRaw : [])
                .map((a: any) => String(a.address || "").toLowerCase())
                .filter(Boolean);
              const direction: "inbound" | "outbound" = ownEmails.has(fromAddr) ? "outbound" : "inbound";

              // Solo añadir si tiene relación con los participantes del hilo
              const participantInvolved =
                (direction === "inbound" && contactAddrs.includes(fromAddr)) ||
                (direction === "outbound" && toAddrs.some((t) => contactAddrs.includes(t)));
              if (!participantInvolved) continue;

              await appendMessage(thread.id, {
                direction,
                from: fromAddr,
                to: toAddrs,
                subject: parsed.subject ?? thread.subject,
                body_html: parsed.html || undefined,
                body_text: parsed.text || undefined,
                message_id: messageId,
                in_reply_to: normMsgId(parsed.inReplyTo) || undefined,
                references: parsed.references
                  ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]).map((r: any) => normMsgId(r)).filter(Boolean)
                  : undefined,
                date: (full.internalDate ?? new Date()).toISOString(),
              });
              knownMsgIds.add(messageId);
              added++;
            } catch (e: any) {
              errors.push(`uid ${uid} en ${folder}: ${e.message}`);
            }
          }
        } finally {
          lock.release();
        }
      } catch (e: any) {
        errors.push(`folder ${folder}: ${e.message}`);
      }
    }
    await client.logout();
  } catch (e: any) {
    return NextResponse.json({ error: e.message, scanned, added }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    thread_id: threadId,
    contact_addresses: contactAddrs,
    scanned,
    added,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  });
}

function normMsgId(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).trim().replace(/^<+|>+$/g, "").trim().toLowerCase();
}
