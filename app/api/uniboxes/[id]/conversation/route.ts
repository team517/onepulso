import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { listAccounts, loadMessagesMap, saveMessagesMap, type UniboxMessage } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/uniboxes/[id]/conversation?contact=<email>&accountId=<id>
 *
 * Busca DIRECTAMENTE en IMAP (INBOX + Sent) TODOS los mensajes intercambiados
 * con ese contacto en los últimos 90 días, los importa al caché y los devuelve.
 *
 * Esto es la red de seguridad cuando el sync incremental no ha traído el
 * mensaje original (porque lleva 100+ enviados desde entonces).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const contact = (req.nextUrl.searchParams.get("contact") || "").toLowerCase().trim();
  const accountId = req.nextUrl.searchParams.get("accountId") || "";
  if (!contact || !contact.includes("@")) {
    return NextResponse.json({ error: "contact email requerido" }, { status: 400 });
  }

  const accs = await listAccounts(id);
  const target = accountId ? accs.filter((a) => a.id === accountId) : accs;
  if (target.length === 0) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });

  const msgsMap = await loadMessagesMap(id);
  let imported = 0;
  const allFound: UniboxMessage[] = [];

  for (const account of target) {
    try {
      const imapPort = account.imap_port || 993;
      const client = new ImapFlow({
        host: account.imap_host,
        port: imapPort,
        secure: imapPort === 993 || imapPort === 995,
        auth: { user: account.imap_user || account.email, pass: account.imap_pass },
        logger: false,
        tls: { rejectUnauthorized: false },
      });
      await client.connect();
      try {
        const list = await client.list();
        // Búsqueda en INBOX (mensajes RECIBIDOS desde el contacto)
        const inboxFolder = list.find((m: any) => m.path === "INBOX");
        if (inboxFolder) {
          await searchFolder(client, "INBOX", { from: contact }, false, accs.find(a => a.id === account.id)!, msgsMap, account.id, allFound);
        }
        // Búsqueda en Sent (mensajes ENVIADOS al contacto)
        const sentFolder = list.find((m: any) =>
          m.specialUse === "\\Sent" ||
          /\[Gmail\]\/Sent Mail/i.test(m.path) ||
          /\[Gmail\]\/Enviados/i.test(m.path) ||
          /^Sent$/i.test(m.path) ||
          /^Enviados$/i.test(m.path)
        );
        if (sentFolder) {
          await searchFolder(client, sentFolder.path, { to: contact }, true, account, msgsMap, account.id, allFound);
        }
      } finally {
        await client.logout().catch(() => {});
      }
    } catch (e: any) {
      console.warn(`[conversation] ${account.email} error:`, e?.message || e);
    }
  }

  imported = allFound.length;
  if (imported > 0) {
    await saveMessagesMap(id, msgsMap);
  }
  return NextResponse.json({ imported, total_found: allFound.length });
}

async function searchFolder(
  client: ImapFlow,
  folderPath: string,
  search: any,
  isSent: boolean,
  account: any,
  msgsMap: Record<string, UniboxMessage[]>,
  accountId: string,
  allFound: UniboxMessage[],
) {
  const lock = await client.getMailboxLock(folderPath);
  try {
    // Búsqueda con 90 días de margen
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const uids = await client.search({ ...search, since });
    if (!uids || (Array.isArray(uids) ? uids.length : 0) === 0) return;

    const existing = msgsMap[accountId] || [];
    const existingMids = new Set(existing.map((m) => (m.messageId || "").toLowerCase().replace(/^<+|>+$/g, "")));

    for await (const msg of client.fetch(uids, { envelope: true, source: true, uid: true, flags: true })) {
      try {
        if (!msg.source) continue;
        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || "(sin asunto)";
        const text = parsed.text || "";
        const html = (parsed.html as string) || "";
        const fromAddr = parsed.from?.text || (msg.envelope as any)?.from?.[0]?.address || "";
        const fromName = (msg.envelope as any)?.from?.[0]?.name || "";
        const fromAddress = (msg.envelope as any)?.from?.[0]?.address || "";

        const wrap = (s: string): string => {
          const t = String(s || "").trim();
          if (!t) return "";
          const cleaned = t.replace(/^<+|>+$/g, "");
          return cleaned ? `<${cleaned}>` : "";
        };
        const messageId = wrap(parsed.messageId || (msg.envelope as any)?.messageId || "");
        const inReplyTo = wrap((parsed.inReplyTo as string) || (msg.envelope as any)?.inReplyTo || "");
        const refsRaw = parsed.references;
        const refsArr = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];
        const references = refsArr.map(wrap).filter(Boolean);

        // Dedup por message-id en lugar de UID (más fiable cross-folder)
        const midKey = (messageId || "").toLowerCase().replace(/^<+|>+$/g, "");
        if (midKey && existingMids.has(midKey)) continue;

        const newMsg: UniboxMessage = {
          uid: isSent ? -1 * msg.uid : msg.uid,
          messageId,
          inReplyTo,
          references,
          from: fromAddr,
          fromName,
          fromAddress,
          to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text).join(", ") : parsed.to.text) : "",
          toAddress: (msg.envelope as any)?.to?.[0]?.address || "",
          subject,
          date: (parsed.date || (msg.envelope as any)?.date || new Date()).toISOString(),
          preview: text.replace(/\s+/g, " ").trim().slice(0, 180),
          text,
          html,
          unread: isSent ? false : !(msg.flags && msg.flags.has("\\Seen")),
          is_warmup: false,
          attachments: (parsed.attachments || []).map((a: any) => ({
            filename: a.filename || "",
            contentType: a.contentType || "",
            size: a.size || 0,
          })),
        };
        if (midKey) existingMids.add(midKey);
        allFound.push(newMsg);
        // Add to msgsMap
        msgsMap[accountId] = [newMsg, ...(msgsMap[accountId] || [])].slice(0, 1500);
      } catch {}
    }
  } finally {
    lock.release();
  }
}
