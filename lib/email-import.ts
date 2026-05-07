import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readEmailConfig } from "./email-config";
import {
  appendMessage,
  createThread,
  findThreadByMessageId,
  findThreadBySubjectAndParticipant,
  getThread,
} from "./email-threads";

type ResolvedFolders = {
  folders: string[];
  sentPath?: string;
};

async function resolveFoldersFull(client: ImapFlow): Promise<ResolvedFolders> {
  const list = (await client.list()) as any[];
  const isGmail = list.some((m) => m.path.startsWith("[Gmail]") || m.path.startsWith("[Google Mail]"));
  let allMail: string | undefined;
  let sent: string | undefined;
  for (const m of list) {
    const su = m.specialUse ?? "";
    const path = m.path ?? "";
    if (su === "\\All" || /\bAll Mail\b|\bTodos\b/i.test(path)) allMail = path;
    if (su === "\\Sent" || /\bSent\b|\bEnviados\b|\bGesendet\b/i.test(path)) {
      if (!sent) sent = path;
    }
  }
  const folders = ["INBOX"];
  if (sent) folders.push(sent);
  if (isGmail && allMail && !folders.includes(allMail)) folders.push(allMail);
  return { folders, sentPath: sent };
}

async function resolveFolders(client: ImapFlow): Promise<string[]> {
  const list = (await client.list()) as any[];
  const isGmail = list.some((m) => m.path.startsWith("[Gmail]") || m.path.startsWith("[Google Mail]"));
  let allMail: string | undefined;
  let sent: string | undefined;
  for (const m of list) {
    const su = m.specialUse ?? "";
    const path = m.path ?? "";
    if (su === "\\All" || /\bAll Mail\b|\bTodos\b/i.test(path)) allMail = path;
    if (su === "\\Sent" || /\bSent\b|\bEnviados\b|\bGesendet\b/i.test(path)) {
      if (!sent) sent = path;
    }
  }
  // Inbox + Sent + (All Mail si Gmail). El dedupe se hace luego por Message-ID.
  const out = ["INBOX"];
  if (sent) out.push(sent);
  if (isGmail && allMail && !out.includes(allMail)) out.push(allMail);
  return out;
}

export async function importThread(opts: {
  gm_thrid?: string;
  subject_seed?: string;
  participant_seed?: string;
}): Promise<{ thread_id: string; imported: number; skipped: number; error?: string }> {
  const cfg = await readEmailConfig();
  if (!cfg) return { thread_id: "", imported: 0, skipped: 0, error: "Email no conectado" };
  if (!opts.gm_thrid && !(opts.subject_seed && opts.participant_seed)) {
    return { thread_id: "", imported: 0, skipped: 0, error: "Falta gm_thrid o (subject + participant)" };
  }

  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
  });

  type Raw = { folder: string; uid: number; parsed: any; date: string };
  const allRaw: Raw[] = [];

  let sentFolderPath: string | undefined;
  try {
    await client.connect();
    const resolved = await resolveFoldersFull(client);
    let folders = resolved.folders;
    sentFolderPath = resolved.sentPath;

    // Optimización: si tenemos gm_thrid + Gmail, basta con [Gmail]/Todos (All Mail) — contiene TODO el thread.
    if (opts.gm_thrid) {
      const list = (await client.list()) as any[];
      const allMail = list.find((m: any) => m.specialUse === "\\All" || /\bAll Mail\b|\bTodos\b/i.test(m.path ?? ""));
      if (allMail) folders = [allMail.path];
    }

    for (const folder of folders) {
      try {
        await client.mailboxOpen(folder, { readOnly: true });
      } catch {
        continue;
      }
      let uids: number[] = [];
      try {
        if (opts.gm_thrid) {
          // En Gmail no hay forma directa de buscar por threadId via search().
          // Workaround: fetch últimos 200 mensajes del folder, filtrar por threadId.
          // Más rápido que buscar por subject en una carpeta de 7000 mensajes.
          const status = await client.status(folder, { messages: true });
          const total = (status as any).messages ?? 0;
          if (total > 0) {
            const start = Math.max(1, total - 500);
            const seqRange = `${start}:${total}`;
            const found: number[] = [];
            for await (const m of client.fetch(seqRange, { threadId: true, uid: true } as any)) {
              if ((m as any).threadId === opts.gm_thrid) {
                found.push((m as any).uid);
              }
            }
            uids = found;
          }
        } else if (opts.subject_seed) {
          const r = await client.search({ subject: opts.subject_seed.replace(/^(re:|fwd?:)\s*/gi, "") });
          uids = Array.isArray(r) ? r : [];
        }
      } catch (e: any) {
        console.warn(`[email-import] search en ${folder} falló:`, e.message);
        uids = [];
      }
      // Asegurar que es array
      if (!Array.isArray(uids)) uids = [];
      uids = uids.slice(-200);
      for (const uid of uids) {
        try {
          const m = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
          if (!m?.source) continue;
          const parsed = await simpleParser(m.source);
          if (!opts.gm_thrid && opts.participant_seed) {
            const fromAddr = parsed.from?.value?.[0]?.address ?? "";
            const toAddrs = ((parsed.to as any)?.value ?? []).map((a: any) => a.address);
            const all = [fromAddr, ...toAddrs].map((s) => (s ?? "").toLowerCase());
            const seed = opts.participant_seed.toLowerCase();
            if (!all.some((s) => s.includes(seed))) continue;
          }
          allRaw.push({
            folder,
            uid,
            parsed,
            date: (m.internalDate ?? parsed.date ?? new Date()).toISOString(),
          });
        } catch {
          /* skip */
        }
      }
    }
    await client.logout();
  } catch (e: any) {
    return { thread_id: "", imported: 0, skipped: 0, error: e.message };
  }

  if (allRaw.length === 0) {
    return { thread_id: "", imported: 0, skipped: 0, error: "No se encontraron mensajes" };
  }

  const seen = new Set<string>();
  const unique = allRaw.filter((r) => {
    const id = r.parsed.messageId;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  unique.sort((a, b) => a.date.localeCompare(b.date));

  const myEmail = cfg.email.toLowerCase();
  const firstSubject = (unique[0].parsed.subject ?? "").replace(/^(re:|fwd?:)\s*/gi, "").trim() || "(sin asunto)";
  const allParticipants = new Set<string>();
  for (const r of unique) {
    const fr = r.parsed.from?.value?.[0]?.address;
    if (fr) allParticipants.add(fr);
    for (const t of (r.parsed.to as any)?.value ?? []) {
      if (t?.address) allParticipants.add(t.address);
    }
  }

  let thread = null as any;
  for (const r of unique) {
    if (r.parsed.messageId) {
      thread = await findThreadByMessageId(r.parsed.messageId);
      if (thread) break;
    }
  }
  if (!thread) {
    const otherParticipant = [...allParticipants].find((p) => p.toLowerCase() !== myEmail);
    if (otherParticipant) {
      thread = await findThreadBySubjectAndParticipant(firstSubject, otherParticipant);
    }
  }
  if (!thread) {
    thread = await createThread({
      subject: firstSubject,
      participants: [...allParticipants],
    });
  }

  const refresh = await getThread(thread.id);
  const existingIds = new Set((refresh?.messages ?? []).map((m: any) => m.message_id).filter(Boolean));

  let imported = 0;
  let skipped = 0;
  for (const r of unique) {
    const p = r.parsed;
    const messageId = p.messageId;
    if (messageId && existingIds.has(messageId)) {
      skipped++;
      continue;
    }
    const fromAddr = p.from?.value?.[0]?.address ?? "";
    const toAddrs: string[] = ((p.to as any)?.value ?? []).map((a: any) => a.address).filter(Boolean);
    // Detección de outbound:
    // 1) Mensaje vino de la carpeta Enviados → outbound (lo más fiable)
    // 2) From coincide con cfg.email
    // 3) From está en send_aliases del config
    const aliases = (cfg.send_aliases ?? []).map((a) => a.toLowerCase());
    const fromLower = fromAddr.toLowerCase();
    const isFromMe = fromLower === myEmail || aliases.includes(fromLower);
    const cameFromSent = sentFolderPath && r.folder === sentFolderPath;
    const direction: "outbound" | "inbound" = (cameFromSent || isFromMe) ? "outbound" : "inbound";
    await appendMessage(thread.id, {
      direction,
      from: fromAddr,
      to: toAddrs,
      subject: p.subject ?? "",
      body_html: p.html || undefined,
      body_text: p.text || undefined,
      message_id: messageId,
      in_reply_to: p.inReplyTo,
      references: Array.isArray(p.references) ? p.references : p.references ? [p.references] : [],
      date: r.date,
    });
    imported++;
  }

  return { thread_id: thread.id, imported, skipped };
}
