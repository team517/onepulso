import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readEmailConfig } from "./email-config";

export type SearchHit = {
  uid: number;
  folder: string;
  message_id?: string;
  gm_thrid?: string;
  from: string;
  to: string[];
  subject: string;
  preview: string;
  date: string;
};

export type GroupedThread = {
  key: string;
  subject: string;
  participants: string[];
  msg_count: number;
  hits: SearchHit[];
  last_date: string;
};

/**
 * Resuelve qué carpetas usar para buscar:
 * - Gmail: usa [Gmail]/All Mail (carpeta con flag \All) que contiene TODO (inbox + sent + archive)
 * - Otros: INBOX + carpeta con flag \Sent
 */
async function resolveFolders(client: ImapFlow): Promise<{ allMailFolder?: string; sentFolder?: string; isGmail: boolean }> {
  const list = await client.list();
  const isGmail = list.some((m: any) => m.path.startsWith("[Gmail]") || m.path.startsWith("[Google Mail]"));
  let allMailFolder: string | undefined;
  let sentFolder: string | undefined;
  for (const m of list as any[]) {
    const su = m.specialUse ?? "";
    const path = m.path ?? "";
    if (su === "\\All" || /\bAll Mail\b|\bTodos\b/i.test(path)) {
      allMailFolder = path;
    }
    if (su === "\\Sent" || /\bSent\b|\bEnviados\b|\bGesendet\b/i.test(path)) {
      if (!sentFolder) sentFolder = path;
    }
  }
  console.log(`[email-search] folders detected: isGmail=${isGmail}, allMail=${allMailFolder}, sent=${sentFolder}`);
  return { allMailFolder, sentFolder, isGmail };
}

export async function listFoldersDebug(): Promise<Array<{ path: string; flags: string[]; specialUse?: string }>> {
  const cfg = await readEmailConfig();
  if (!cfg) return [];
  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
  });
  try {
    await client.connect();
    const list = (await client.list()) as any[];
    await client.logout();
    return list.map((m) => ({
      path: m.path,
      flags: (m.flags ?? []) as string[],
      specialUse: m.specialUse,
    }));
  } catch {
    return [];
  }
}

/**
 * Detecta si el query es exactamente un email y lo transforma a `(from:X OR to:X)`
 * para que Gmail haga matching estricto en headers, no como texto suelto.
 */
function buildSearchQuery(rawQuery: string): { query: string; targetEmail?: string; isEmailLookup: boolean } {
  const trimmed = rawQuery.trim();
  // Si ya tiene operadores de Gmail, dejar tal cual
  if (/\b(from|to|cc|bcc|subject|after|before|has|is|label):/i.test(trimmed)) {
    return { query: trimmed, isEmailLookup: false };
  }
  // Si es exactamente un email
  const emailRe = /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/;
  if (emailRe.test(trimmed)) {
    return { query: `(from:${trimmed} OR to:${trimmed} OR cc:${trimmed})`, targetEmail: trimmed.toLowerCase(), isEmailLookup: true };
  }
  // Si es solo un dominio (rebai.ai)
  const domainRe = /^[\w-]+\.[\w.-]+$/;
  if (domainRe.test(trimmed)) {
    return { query: `(from:${trimmed} OR to:${trimmed})`, targetEmail: trimmed.toLowerCase(), isEmailLookup: true };
  }
  return { query: trimmed, isEmailLookup: false };
}

export async function searchEmails(
  query: string,
  max = 30
): Promise<{ hits: SearchHit[]; threads: GroupedThread[]; folders_searched: string[]; error?: string }> {
  const cfg = await readEmailConfig();
  if (!cfg) return { hits: [], threads: [], folders_searched: [], error: "Email no conectado" };
  if (!query.trim()) return { hits: [], threads: [], folders_searched: [] };

  const built = buildSearchQuery(query);
  console.log(`[email-search] query original "${query}" -> "${built.query}" (email lookup: ${built.isEmailLookup})`);

  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
  });

  const allHits: SearchHit[] = [];
  const foldersSearched: string[] = [];

  try {
    await client.connect();
    const { allMailFolder, sentFolder, isGmail } = await resolveFolders(client);

    // Estrategia: buscar en INBOX + Sent + (All Mail si Gmail) y deduplicar.
    // Esto garantiza que se encuentren emails enviados aunque Gmail los archive.
    const folders: string[] = ["INBOX"];
    if (sentFolder) folders.push(sentFolder);
    if (isGmail && allMailFolder && !folders.includes(allMailFolder)) folders.push(allMailFolder);

    for (const folder of folders) {
      try {
        await client.mailboxOpen(folder, { readOnly: true });
      } catch (e: any) {
        console.warn(`[email-search] no pude abrir folder ${folder}: ${e.message}`);
        continue;
      }
      console.log(`[email-search] folder abierto: ${folder}`);
      foldersSearched.push(folder);

      let uids: number[] = [];
      // Para email lookups en Gmail: la search IMAP es poco fiable.
      // Estrategia: fetch los últimos N mensajes del folder y filtramos en JS.
      if (built.targetEmail && isGmail) {
        const status = await client.status(folder, { messages: true });
        const total = (status as any).messages ?? 0;
        const scanRange = Math.min(500, total);
        if (scanRange > 0) {
          const start = Math.max(1, total - scanRange + 1);
          const seqRange = `${start}:${total}`;
          const target = built.targetEmail.toLowerCase();
          for await (const m of client.fetch(seqRange, { envelope: true, threadId: true, uid: true, internalDate: true } as any) as any) {
            const env = (m as any).envelope ?? {};
            const fromAddr = (addrToString(env.from?.[0]) ?? "").toLowerCase();
            const toArr: string[] = [
              ...((env.to ?? []).map(addrToString) as string[]),
              ...((env.cc ?? []).map(addrToString) as string[]),
              ...((env.bcc ?? []).map(addrToString) as string[]),
            ].filter(Boolean).map((s) => s.toLowerCase());
            const matches = fromAddr.includes(target) || toArr.some((t) => t.includes(target));
            if (matches) uids.push((m as any).uid);
          }
          console.log(`[email-search] scan ${seqRange} en ${folder}: ${uids.length} hits para "${target}"`);
        }
      } else if (built.targetEmail) {
        // No-Gmail: usar IMAP search estándar
        const fromHits = ((await client.search({ from: built.targetEmail }).catch(() => [])) as number[]) || [];
        const toHits = ((await client.search({ to: built.targetEmail }).catch(() => [])) as number[]) || [];
        const ccHits = ((await client.search({ cc: built.targetEmail }).catch(() => [])) as number[]) || [];
        uids = Array.from(new Set([...fromHits, ...toHits, ...ccHits]));
      } else if (isGmail) {
        try {
          uids = ((await client.search({ gmailRaw: built.query } as any).catch(() => [])) as number[]) || [];
        } catch {
          uids = [];
        }
      } else {
        try {
          uids = ((await client.search({
            or: [{ from: query }, { to: query }, { subject: query }, { body: query }] as any,
          } as any).catch(() => [])) as number[]) || [];
        } catch {
          uids = [];
        }
      }
      if (!Array.isArray(uids)) uids = [];
      const lastUids = uids.slice(-max);

      for (const uid of lastUids) {
        try {
          // threadId es la propiedad oficial de imapflow para X-GM-THRID
          const m = await client.fetchOne(
            uid,
            { envelope: true, internalDate: true, threadId: true } as any,
            { uid: true }
          );
          if (!m) continue;
          const env = m.envelope as any;
          let messageId = env?.messageId ?? "";
          let gm_thrid: string | undefined = (m as any).threadId;
          let from = addrToString(env?.from?.[0]);
          // Recoger to + cc + bcc — el usuario puede tener al destinatario en cualquiera de los 3
          const toArr: string[] = (env?.to ?? []).map(addrToString).filter(Boolean);
          const ccArr: string[] = (env?.cc ?? []).map(addrToString).filter(Boolean);
          const bccArr: string[] = (env?.bcc ?? []).map(addrToString).filter(Boolean);
          let to: string[] = Array.from(new Set([...toArr, ...ccArr, ...bccArr]));
          let subject = env?.subject ?? "";
          let preview = "";

          // Debug: si es email lookup, log lo que vemos
          if (built.targetEmail) {
            console.log(`[email-search] hit ${folder}/${uid}: from=${from} to=${JSON.stringify(to)} subj=${subject.slice(0,40)}`);
          }
          allHits.push({
            uid,
            folder,
            message_id: messageId,
            gm_thrid,
            from,
            to,
            subject,
            preview,
            date: (m.internalDate ?? new Date()).toISOString(),
          });
        } catch {
          /* skip */
        }
      }
    }
    await client.logout();
  } catch (e: any) {
    return { hits: [], threads: [], folders_searched: foldersSearched, error: e.message };
  }

  // Dedupe por message_id
  const seen = new Set<string>();
  let dedup: SearchHit[] = [];
  for (const h of allHits) {
    const k = h.message_id || `${h.folder}:${h.uid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(h);
  }

  // Si query era un email: priorizar hits con match directo en envelope.
  // Si no hay direct match, mantener los demás como "thread match" (Gmail los considera relacionados).
  if (built.targetEmail) {
    const target = built.targetEmail;
    const direct = dedup.filter((h) =>
      h.from?.toLowerCase().includes(target) ||
      h.to.some((t) => t.toLowerCase().includes(target))
    );
    if (direct.length > 0) {
      // Hay match directo: priorizar esos pero mantener los thread-matches al final
      const indirect = dedup.filter((h) => !direct.includes(h));
      dedup = [...direct, ...indirect];
    }
    console.log(`[email-search] direct envelope matches: ${direct.length}/${dedup.length}`);
  }

  // Group by thread (gm_thrid si Gmail, sino subject + participantes normalizados)
  const threadMap = new Map<string, GroupedThread>();
  for (const h of dedup) {
    const key = h.gm_thrid ?? `${normSubject(h.subject)}::${h.from}`;
    if (!threadMap.has(key)) {
      threadMap.set(key, {
        key,
        subject: h.subject || "(sin asunto)",
        participants: Array.from(new Set([h.from, ...h.to].filter(Boolean))),
        msg_count: 0,
        hits: [],
        last_date: h.date,
      });
    }
    const t = threadMap.get(key)!;
    t.msg_count++;
    t.hits.push(h);
    if (h.date > t.last_date) t.last_date = h.date;
    for (const p of [h.from, ...h.to].filter(Boolean)) {
      if (!t.participants.includes(p)) t.participants.push(p);
    }
  }
  const threads = [...threadMap.values()].sort((a, b) => b.last_date.localeCompare(a.last_date));
  return { hits: dedup, threads, folders_searched: foldersSearched };
}

function normSubject(s: string): string {
  return s.replace(/^(re:|fwd?:)\s*/gi, "").trim().toLowerCase();
}

/**
 * Convierte el formato envelope de ImapFlow a "user@host".
 * Soporta dos formatos: { address } (nuevo) o { mailbox, host } (legacy).
 */
function addrToString(a: any): string {
  if (!a) return "";
  if (a.address) return String(a.address);
  if (a.mailbox && a.host) return `${a.mailbox}@${a.host}`;
  return "";
}
