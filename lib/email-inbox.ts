import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readEmailConfig } from "./email-config";
import {
  appendMessage,
  createThread,
  findThreadByMessageId,
  findThreadBySubjectAndParticipant,
  listThreads,
} from "./email-threads";

let _hasMailparser = false;
try {
  // mailparser may or may not be installed; lazy-load
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require.resolve("mailparser");
  _hasMailparser = true;
} catch {
  _hasMailparser = false;
}

export type SyncResult = {
  fetched: number;
  new_messages: number;
  threads_touched: string[];
  error?: string;
};

/**
 * Conecta a IMAP, descarga últimos N días de inbox, asocia mensajes a threads.
 */
export async function syncInbox(opts: { days?: number; max?: number } = {}): Promise<SyncResult> {
  const days = opts.days ?? 7;
  const max = opts.max ?? 50;

  const cfg = await readEmailConfig();
  if (!cfg) return { fetched: 0, new_messages: 0, threads_touched: [], error: "Email no conectado" };

  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
  });

  let fetched = 0;
  let newMessages = 0;
  const threadsTouched = new Set<string>();
  let error: string | undefined;

  try {
    await client.connect();
    // Sync solo de INBOX para entrantes nuevos (los enviados se trackean al hacer send)
    const lock = await client.getMailboxLock("INBOX");
    try {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const uids = await client.search({ since });
      const lastUids = uids.slice(-max);

      // Track existing message_ids to avoid duplicates
      const existingThreads = await listThreads();
      const existingMsgIds = new Set<string>();
      for (const t of existingThreads) {
        for (const m of t.messages) {
          if (m.message_id) existingMsgIds.add(m.message_id);
        }
      }

      for (const uid of lastUids) {
        fetched++;
        const fullMsg = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
        if (!fullMsg || !fullMsg.source) continue;

        let from = "";
        let to: string[] = [];
        let subject = "";
        let bodyText = "";
        let bodyHtml = "";
        let messageId = "";
        let inReplyTo: string | undefined;
        let references: string[] = [];

        if (_hasMailparser) {
          const parsed = await simpleParser(fullMsg.source);
          from = parsed.from?.value?.[0]?.address ?? "";
          const toAddrs = (parsed.to as any)?.value ?? [];
          to = Array.isArray(toAddrs) ? toAddrs.map((a: any) => a.address).filter(Boolean) : [];
          subject = parsed.subject ?? "";
          bodyText = parsed.text ?? "";
          bodyHtml = parsed.html || "";
          messageId = parsed.messageId ?? "";
          inReplyTo = parsed.inReplyTo;
          if (parsed.references) {
            references = Array.isArray(parsed.references) ? parsed.references : [parsed.references];
          }
        } else {
          // Fallback: usar envelope (sin body)
          const env = fullMsg.envelope as any;
          if (env) {
            from = env.from?.[0]?.address ?? (env.from?.[0]?.mailbox && env.from?.[0]?.host ? `${env.from[0].mailbox}@${env.from[0].host}` : "");
            to = (env.to ?? []).map((a: any) => a.address ?? (a.mailbox && a.host ? `${a.mailbox}@${a.host}` : "")).filter(Boolean);
            subject = env.subject ?? "";
            messageId = env.messageId ?? "";
            inReplyTo = env.inReplyTo;
          }
        }

        if (!messageId || existingMsgIds.has(messageId)) continue;

        // Match a thread:
        // 1. By in_reply_to / references
        // 2. By subject + participant
        // 3. Otherwise create new thread
        let thread = null as any;
        if (inReplyTo) thread = await findThreadByMessageId(inReplyTo);
        if (!thread) {
          for (const ref of references) {
            thread = await findThreadByMessageId(ref);
            if (thread) break;
          }
        }
        if (!thread && subject) {
          thread = await findThreadBySubjectAndParticipant(subject, from);
        }
        if (!thread) {
          thread = await createThread({
            subject: subject.replace(/^(re:|fwd?:)\s*/gi, "").trim() || "(sin asunto)",
            participants: [from, ...to].filter(Boolean),
          });
        }

        await appendMessage(thread.id, {
          direction: "inbound",
          from,
          to,
          subject,
          body_html: bodyHtml || undefined,
          body_text: bodyText || undefined,
          message_id: messageId,
          in_reply_to: inReplyTo,
          references,
          date: (fullMsg.internalDate ?? new Date()).toISOString(),
        });
        threadsTouched.add(thread.id);
        newMessages++;
        existingMsgIds.add(messageId);
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e: any) {
    error = e.message;
  }

  return { fetched, new_messages: newMessages, threads_touched: [...threadsTouched], error };
}

export async function verifyImap(): Promise<{ ok: boolean; error?: string }> {
  const cfg = await readEmailConfig();
  if (!cfg) return { ok: false, error: "no config" };
  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
