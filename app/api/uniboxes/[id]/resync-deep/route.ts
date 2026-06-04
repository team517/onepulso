import { NextRequest, NextResponse } from "next/server";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { listAccounts, loadMessagesMap, saveMessagesMap, isBounceOrFailure, type UniboxMessage } from "@/lib/unibox-store";
import { isWarmupMessage } from "@/lib/unibox-warmup";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/uniboxes/[id]/resync-deep
 *
 * Re-sincroniza TODAS las cuentas trayendo los últimos 30 días de INBOX y
 * Sent, aplicando el filtro de bounce ACTUALIZADO. Sirve para "rescatar"
 * mensajes legítimos que el filtro viejo (que descartaba todo noreply@)
 * marcó como bounce y por tanto nunca llegaron a la bandeja.
 *
 * Devuelve recuento de mensajes recuperados por cuenta.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const accs = await listAccounts(id);
  if (accs.length === 0) return NextResponse.json({ ok: true, recovered: 0, accounts: [] });

  const msgsMap = await loadMessagesMap(id);
  const report: Array<{ email: string; recovered: number; error?: string }> = [];

  // Paralelo, lotes de 8
  const CONCURRENCY = 8;
  for (let i = 0; i < accs.length; i += CONCURRENCY) {
    const batch = accs.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async (account) => {
        let recovered = 0;
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
            const inboxFolder = list.find((m: any) => m.path === "INBOX");
            if (inboxFolder) {
              const r = await scanFolder(client, "INBOX", false, account.id, msgsMap, 30);
              recovered += r;
            }
            const sentFolder = list.find((m: any) =>
              m.specialUse === "\\Sent" ||
              /\[Gmail\]\/Sent Mail/i.test(m.path) ||
              /\[Gmail\]\/Enviados/i.test(m.path) ||
              /^Sent$/i.test(m.path) ||
              /^Enviados$/i.test(m.path)
            );
            if (sentFolder) {
              const r = await scanFolder(client, sentFolder.path, true, account.id, msgsMap, 30);
              recovered += r;
            }
          } finally {
            await client.logout().catch(() => {});
          }
          report.push({ email: account.email, recovered });
        } catch (e: any) {
          report.push({ email: account.email, recovered, error: e?.message || String(e) });
        }
      })
    );
  }

  // Re-clasificar TODOS los mensajes ya cacheados aplicando el filtro NUEVO:
  // - Los que estaban marcados is_warmup por filtro viejo demasiado agresivo
  //   se desmarcan si no encajan con la lógica nueva (más estricta).
  // - Los que ahora matchean bounce se purgan.
  let reclassWarmup = 0, reclassUnflagged = 0, purgedBounces = 0;
  for (const accId of Object.keys(msgsMap)) {
    const kept: UniboxMessage[] = [];
    for (const m of msgsMap[accId]) {
      if (isBounceOrFailure({ from: m.from, fromAddress: m.fromAddress, fromName: m.fromName, subject: m.subject, text: m.text })) {
        purgedBounces++;
        continue;
      }
      const wasWarmup = !!m.is_warmup;
      const isWarmupNow = isWarmupMessage({ subject: m.subject, text: m.text, html: m.html, from: m.from });
      if (isWarmupNow) reclassWarmup++;
      if (wasWarmup && !isWarmupNow) reclassUnflagged++;
      kept.push({ ...m, is_warmup: isWarmupNow });
    }
    msgsMap[accId] = kept;
  }

  await saveMessagesMap(id, msgsMap);
  const totalRecovered = report.reduce((s, r) => s + r.recovered, 0);
  return NextResponse.json({
    ok: true,
    recovered: totalRecovered,
    unflagged_from_warmup: reclassUnflagged,
    still_warmup: reclassWarmup,
    purged_bounces: purgedBounces,
    accounts: report,
  });
}

async function scanFolder(
  client: ImapFlow,
  folderPath: string,
  isSent: boolean,
  accountId: string,
  msgsMap: Record<string, UniboxMessage[]>,
  daysBack: number,
): Promise<number> {
  const lock = await client.getMailboxLock(folderPath);
  let added = 0;
  try {
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
    const uids = await client.search({ since });
    if (!uids || (Array.isArray(uids) ? uids.length === 0 : true)) return 0;

    const existing = msgsMap[accountId] || [];
    const existingMids = new Set(
      existing.map((m) => (m.messageId || "").toLowerCase().replace(/^<+|>+$/g, "")).filter(Boolean)
    );
    const existingUids = new Set(existing.map((m) => String(m.uid)));

    for await (const msg of client.fetch(uids, { envelope: true, source: true, uid: true, flags: true })) {
      try {
        if (!msg.source) continue;
        const uidPseudo = isSent ? -1 * msg.uid : msg.uid;
        if (existingUids.has(String(uidPseudo))) continue;

        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || "(sin asunto)";
        const text = parsed.text || "";
        const html = (parsed.html as string) || "";
        const fromAddr = parsed.from?.text || (msg.envelope as any)?.from?.[0]?.address || "";
        const fromName = (msg.envelope as any)?.from?.[0]?.name || "";
        const fromAddress = (msg.envelope as any)?.from?.[0]?.address || "";

        // Aplicar filtro NUEVO — los que pasan, los importamos.
        if (isBounceOrFailure({ from: fromAddr, fromAddress, fromName, subject, text })) continue;

        const wrap = (s: string): string => {
          const t = String(s || "").trim();
          if (!t) return "";
          const cleaned = t.replace(/^<+|>+$/g, "");
          return cleaned ? `<${cleaned}>` : "";
        };
        const messageId = wrap(parsed.messageId || (msg.envelope as any)?.messageId || "");
        if (messageId) {
          const k = messageId.toLowerCase().replace(/^<+|>+$/g, "");
          if (existingMids.has(k)) continue;
          existingMids.add(k);
        }
        const inReplyTo = wrap((parsed.inReplyTo as string) || (msg.envelope as any)?.inReplyTo || "");
        const refsRaw = parsed.references;
        const refsArr = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];
        const references = refsArr.map(wrap).filter(Boolean);

        const newMsg: UniboxMessage = {
          uid: uidPseudo,
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
          is_warmup: isWarmupMessage({ subject, text, html, from: fromAddr }),
          attachments: (parsed.attachments || []).map((a: any) => ({
            filename: a.filename || "",
            contentType: a.contentType || "",
            size: a.size || 0,
          })),
        };
        msgsMap[accountId] = [newMsg, ...(msgsMap[accountId] || [])].slice(0, 1500);
        added++;
      } catch {}
    }
  } finally {
    lock.release();
  }
  return added;
}
