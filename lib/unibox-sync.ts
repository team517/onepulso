import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import {
  UniboxAccount,
  UniboxMessage,
  listAccounts,
  saveAccounts,
  loadMessagesMap,
  saveMessagesMap,
  updateUnibox,
} from "./unibox-store";
import { isWarmupMessage } from "./unibox-warmup";

/** Sincroniza una cuenta IMAP — descarga últimos 50 mensajes, los mergea en caché. */
export async function syncAccount(uniboxId: string, accountId: string): Promise<number> {
  const accs = await listAccounts(uniboxId);
  const idx = accs.findIndex((a) => a.id === accountId);
  if (idx === -1) return 0;
  const account = accs[idx];

  const imapPort = account.imap_port || 993;
  const client = new ImapFlow({
    host: account.imap_host,
    port: imapPort,
    secure: imapPort === 993 || imapPort === 995,
    auth: {
      user: account.imap_user || account.email,
      pass: account.imap_pass,
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  let newCount = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msgsMap = await loadMessagesMap(uniboxId);
      const existing = msgsMap[accountId] || [];
      const existingUids = new Set(existing.map((m) => String(m.uid)));

      const status = await client.status("INBOX", { messages: true });
      const total = status.messages || 0;
      if (total === 0) {
        accs[idx].last_sync = new Date().toISOString();
        accs[idx].last_error = null;
        await saveAccounts(uniboxId, accs);
        await client.logout();
        return 0;
      }
      const start = Math.max(1, total - 49);
      const range = `${start}:*`;

      const fresh: UniboxMessage[] = [];
      for await (const msg of client.fetch(range, { envelope: true, source: true, uid: true, flags: true })) {
        const uidStr = String(msg.uid);
        if (existingUids.has(uidStr)) continue;
        try {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject || (msg.envelope as any)?.subject || "(sin asunto)";
          const text = parsed.text || "";
          const html = (parsed.html as string) || "";
          const fromAddr = parsed.from?.text || (msg.envelope as any)?.from?.[0]?.address || "";
          const warmup = isWarmupMessage({ subject, text, html, from: fromAddr });

          const inReplyTo = (parsed.inReplyTo as string) || "";
          const refsRaw = parsed.references;
          const references = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];

          fresh.push({
            uid: msg.uid,
            messageId: parsed.messageId || "",
            inReplyTo,
            references,
            from: fromAddr,
            fromName: (msg.envelope as any)?.from?.[0]?.name || "",
            fromAddress: (msg.envelope as any)?.from?.[0]?.address || "",
            to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(", ") : parsed.to.text) : "",
            toAddress: (msg.envelope as any)?.to?.[0]?.address || "",
            subject,
            date: (parsed.date || (msg.envelope as any)?.date || new Date()).toISOString(),
            preview: text.replace(/\s+/g, " ").trim().slice(0, 180),
            text,
            html,
            unread: !(msg.flags && msg.flags.has("\\Seen")),
            is_warmup: warmup,
            attachments: (parsed.attachments || []).map((a: any) => ({
              filename: a.filename || "",
              contentType: a.contentType || "",
              size: a.size || 0,
            })),
          });
          newCount++;
        } catch {}
      }

      msgsMap[accountId] = [...fresh, ...existing].slice(0, 200);
      await saveMessagesMap(uniboxId, msgsMap);
    } finally {
      lock.release();
    }
    await client.logout();
    accs[idx].last_sync = new Date().toISOString();
    accs[idx].last_error = null;
    await saveAccounts(uniboxId, accs);
    return newCount;
  } catch (e: any) {
    accs[idx].last_error = e.message || String(e);
    await saveAccounts(uniboxId, accs);
    try { await client.logout(); } catch {}
    throw e;
  }
}

/** Sincroniza todas las cuentas de una unibox. */
export async function syncUnibox(uniboxId: string): Promise<{ ok: number; fail: number; new: number }> {
  const accs = await listAccounts(uniboxId);
  let ok = 0, fail = 0, total = 0;
  for (const a of accs) {
    try {
      total += await syncAccount(uniboxId, a.id);
      ok++;
    } catch {
      fail++;
    }
  }
  await updateUnibox(uniboxId, { last_sync: new Date().toISOString() });
  return { ok, fail, new: total };
}

/** Reclasifica todos los mensajes cacheados aplicando isWarmupMessage actual. */
export async function reclassifyMessages(uniboxId: string): Promise<{ total: number; warmup: number; clean: number }> {
  const msgsMap = await loadMessagesMap(uniboxId);
  let total = 0, warmup = 0;
  for (const accId of Object.keys(msgsMap)) {
    msgsMap[accId] = msgsMap[accId].map((m) => {
      const flag = isWarmupMessage({ subject: m.subject, text: m.text, html: m.html, from: m.from });
      total++;
      if (flag) warmup++;
      return { ...m, is_warmup: flag };
    });
  }
  await saveMessagesMap(uniboxId, msgsMap);
  return { total, warmup, clean: total - warmup };
}
