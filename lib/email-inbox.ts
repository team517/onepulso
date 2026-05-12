import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readEmailConfig } from "./email-config";
import {
  appendMessage,
  createThread,
  findThreadByMessageId,
  findThreadBySubjectAndParticipant,
  listThreads,
  updateFollowup,
  Thread,
} from "./email-threads";

let _hasMailparser = false;
try {
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

function normMsgId(s: string | undefined | null): string {
  if (!s) return "";
  return String(s).trim().replace(/^<+|>+$/g, "").trim().toLowerCase();
}

/** Procesa un conjunto de UIDs: fetch + parse + append a thread. */
async function processUids(
  client: ImapFlow,
  uids: number[],
  ownEmails: Set<string>,
  watchedAddrs: Set<string>,
  knownMsgIds: Set<string>,
  threadsTouched: Set<string>,
): Promise<{ fetched: number; new_messages: number }> {
  let fetched = 0;
  let newMessages = 0;

  for (const uid of uids) {
    fetched++;
    try {
      const fullMsg = await client.fetchOne(
        uid,
        { source: true, envelope: true, internalDate: true },
        { uid: true }
      );
      if (!fullMsg) continue;

      const parsed = _hasMailparser && fullMsg.source ? await simpleParser(fullMsg.source) : null;
      const messageId = normMsgId(parsed?.messageId ?? (fullMsg.envelope as any)?.messageId);
      if (!messageId || knownMsgIds.has(messageId)) continue;

      let from = "";
      let to: string[] = [];
      let subject = "";
      let bodyText = "";
      let bodyHtml = "";
      let inReplyTo: string | undefined;
      let references: string[] = [];

      if (parsed) {
        from = (parsed.from?.value?.[0]?.address ?? "").toLowerCase();
        const toAddrs = (parsed.to as any)?.value ?? [];
        to = (Array.isArray(toAddrs) ? toAddrs : [])
          .map((a: any) => String(a.address || "").toLowerCase())
          .filter(Boolean);
        subject = parsed.subject ?? "";
        bodyText = parsed.text ?? "";
        bodyHtml = parsed.html || "";
        inReplyTo = normMsgId(parsed.inReplyTo) || undefined;
        if (parsed.references) {
          const refs = Array.isArray(parsed.references) ? parsed.references : [parsed.references];
          references = refs.map((r: any) => normMsgId(r)).filter(Boolean);
        }
      } else {
        const env = fullMsg.envelope as any;
        if (env) {
          from = (env.from?.[0]?.address ?? (env.from?.[0]?.mailbox && env.from?.[0]?.host ? `${env.from[0].mailbox}@${env.from[0].host}` : "")).toLowerCase();
          to = ((env.to ?? []).map((a: any) => (a.address ?? (a.mailbox && a.host ? `${a.mailbox}@${a.host}` : ""))) as string[])
            .map(s => String(s).toLowerCase())
            .filter(Boolean);
          subject = env.subject ?? "";
          inReplyTo = normMsgId(env.inReplyTo) || undefined;
        }
      }

      const direction: "inbound" | "outbound" = ownEmails.has(from) ? "outbound" : "inbound";

      // Match thread existente (solo hilos que el usuario ya añadió manualmente).
      // findThreadByMessageId y findThreadBySubjectAndParticipant ya filtran por hilos existentes.
      let thread: Thread | null = null;
      if (inReplyTo) thread = await findThreadByMessageId(inReplyTo);
      if (!thread) {
        for (const ref of references) {
          thread = await findThreadByMessageId(ref);
          if (thread) break;
        }
      }
      if (!thread && subject) {
        const matchAddr = direction === "inbound" ? from : (to[0] || "");
        if (matchAddr) thread = await findThreadBySubjectAndParticipant(subject, matchAddr);
      }

      // Si llega un INBOUND a un hilo existente del usuario, cancelar los
      // follow-ups programados de ese hilo (la conversación cambió, ya no
      // hace falta perseguir al prospect).
      // FILTRO ULTRA-ESTRICTO: el sync NUNCA crea hilos nuevos.
      // Los hilos sólo se crean cuando el usuario hace:
      //   - "+ Nuevo" (compose) → /api/email/send crea el thread
      //   - 🔎 Buscar e importar → /api/email/import crea el thread
      // Si no hay match con un hilo existente del usuario → SKIP.
      // Esto garantiza que nunca aparezcan contactos que no buscó manualmente.
      if (!thread) {
        continue;
      }
      // Además, sólo procesamos mensajes en hilos marcados como watched=true.
      // Si por algún motivo un hilo no está watched, no se le añaden mensajes nuevos
      // (deberá ser eliminado o re-añadirse desde búsqueda).
      if ((thread as any).watched !== true) {
        continue;
      }

      await appendMessage(thread.id, {
        direction,
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
      knownMsgIds.add(messageId);

      // Si fue un INBOUND, cancelar follow-ups programados o pending_approval
      // de este hilo (el prospect respondió, la secuencia para automáticamente).
      if (direction === "inbound") {
        for (const f of thread.followups) {
          if (f.status === "scheduled" || f.status === "pending_approval") {
            await updateFollowup(thread.id, f.id, { status: "cancelled" });
          }
        }
      }
    } catch (msgErr: any) {
      console.warn(`[email-inbox] error processing uid ${uid}:`, msgErr.message);
    }
  }

  return { fetched, new_messages: newMessages };
}

export async function syncInbox(opts: { days?: number; max?: number } = {}): Promise<SyncResult> {
  const days = opts.days ?? 7;
  const max = opts.max ?? 100;

  const cfg = await readEmailConfig();
  if (!cfg) return { fetched: 0, new_messages: 0, threads_touched: [], error: "Email no conectado" };

  const client = new ImapFlow({
    host: cfg.imap_host,
    port: cfg.imap_port,
    secure: cfg.imap_secure,
    auth: { user: cfg.imap_user, pass: cfg.imap_password },
    logger: false,
    socketTimeout: 5 * 60 * 1000,
    greetingTimeout: 30 * 1000,
    connectionTimeout: 60 * 1000,
  } as any);

  // Manejar errores de socket sin crashear el proceso
  (client as any).on?.("error", (err: any) => {
    console.warn("[email-inbox] imap socket error:", err?.message || err);
  });

  let totalFetched = 0;
  let totalNew = 0;
  const threadsTouched = new Set<string>();
  let error: string | undefined;

  const ownEmails = new Set<string>([
    cfg.email.toLowerCase(),
    ...((cfg as any).send_aliases ?? []).map((a: string) => String(a).toLowerCase()),
  ]);

  // Solo rastreamos contactos a los que YO he escrito explícitamente.
  //   - Para cada thread con outbound, todos los `to` de mis mensajes outbound se añaden
  //   - Threads marcados como `watched=true` también se incluyen (importados via búsqueda)
  // Esto evita que cualquier email entrante aleatorio (notificaciones, factura, spam,
  // outreach de otros) acabe creando un hilo en mi vista.
  const existingThreads = await listThreads();
  const watchedAddrs = new Set<string>();
  for (const t of existingThreads) {
    if (t.status === "closed") continue;
    // Si está marcado como watched (importado, abierto), incluir sus participants
    if ((t as any).watched === true) {
      for (const p of t.participants) {
        const addr = String(p).toLowerCase().trim();
        if (addr && !ownEmails.has(addr)) watchedAddrs.add(addr);
      }
    }
    // Para cada mensaje outbound, añadir todos los destinatarios `to`
    for (const m of t.messages) {
      if (m.direction === "outbound") {
        for (const dst of m.to || []) {
          const addr = String(dst).toLowerCase().trim();
          if (addr && !ownEmails.has(addr)) watchedAddrs.add(addr);
        }
      }
    }
  }
  console.log(`[email-inbox] strict watch: ${watchedAddrs.size} contacts (sólo a quien he escrito o marcado watched)`);

  // knownMsgIds para evitar duplicados
  const knownMsgIds = new Set<string>();
  for (const t of existingThreads) {
    for (const m of t.messages) {
      const id = normMsgId(m.message_id);
      if (id) knownMsgIds.add(id);
    }
  }

  try {
    await client.connect();

    // Detectar carpetas
    const folders: string[] = [];
    try {
      const list = await client.list();
      if (list.find(m => /^inbox$/i.test(m.path))) folders.push("INBOX");
      const allMail = list.find(m =>
        m.specialUse === "\\All" ||
        /\[Gmail\]\/All Mail/i.test(m.path) ||
        /\[Gmail\]\/Todos/i.test(m.path)
      );
      if (allMail) folders.push(allMail.path);
      const spam = list.find(m =>
        m.specialUse === "\\Junk" ||
        /\[Gmail\]\/Spam/i.test(m.path) ||
        /\[Gmail\]\/Correo no deseado/i.test(m.path)
      );
      if (spam) folders.push(spam.path);
    } catch {
      folders.push("INBOX");
    }

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    for (const folder of folders) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          // 1) Búsqueda PRIORITARIA por participante activo (rápida, pocos UIDs)
          const targetedUids: number[] = [];
          for (const addr of watchedAddrs) {
            try {
              const fromUids = (await client.search({ from: addr } as any, { uid: true })) ?? [];
              targetedUids.push(...fromUids);
            } catch (e: any) {
              console.warn(`[email-inbox] from search ${addr} failed:`, e.message);
            }
          }
          const targetedUnique = Array.from(new Set(targetedUids));
          console.log(`[email-inbox] folder=${folder} targeted UIDs: ${targetedUnique.length}`);

          // PROCESAR TARGETED PRIMERO
          const r1 = await processUids(client, targetedUnique, ownEmails, watchedAddrs, knownMsgIds, threadsTouched);
          totalFetched += r1.fetched;
          totalNew += r1.new_messages;

          // 2) Búsqueda general por fecha (después)
          let recentUids: number[] = [];
          try {
            const generalUids: number[] = (await client.search({ since }, { uid: true })) ?? [];
            generalUids.sort((a, b) => a - b);
            recentUids = generalUids.slice(-max);
          } catch (e: any) {
            console.warn("[email-inbox] general search failed:", e.message);
          }
          const generalToProcess = recentUids.filter(u => !targetedUnique.includes(u));

          const r2 = await processUids(client, generalToProcess, ownEmails, watchedAddrs, knownMsgIds, threadsTouched);
          totalFetched += r2.fetched;
          totalNew += r2.new_messages;
        } finally {
          lock.release();
        }
      } catch (folderErr: any) {
        console.warn(`[email-inbox] could not scan folder ${folder}:`, folderErr.message);
      }
    }

    await client.logout();
  } catch (e: any) {
    error = e.message;
  }

  return { fetched: totalFetched, new_messages: totalNew, threads_touched: [...threadsTouched], error };
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
