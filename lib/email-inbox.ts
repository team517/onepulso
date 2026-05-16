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
  updateThread,
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

/** Busca un hilo abierto donde el contacto sea participant. Si hay múltiples, devuelve el más reciente. */
async function findThreadByParticipant(contactEmail: string, ownEmails: Set<string>): Promise<Thread | null> {
  const all = await listThreads();
  const addr = contactEmail.toLowerCase().trim();
  if (!addr || ownEmails.has(addr)) return null;
  const candidates = all.filter(
    (t) => t.status !== "closed" && t.participants.some((p) => String(p).toLowerCase().trim() === addr)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return candidates[0];
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

      // Match thread existente — orden de precisión a tolerancia:
      //   1) Message-ID exacto del In-Reply-To
      //   2) Cualquiera de las References
      //   3) Subject + participante
      //   4) NUEVO: participante en cualquier hilo abierto (fallback amplio)
      //      → cubre casos donde el cliente del prospect rompe el threading
      //      (no manda In-Reply-To, cambia el subject, etc.)
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
      // Fallback amplio: si es inbound, busca cualquier hilo abierto donde
      // el remitente sea participante. Cubre clientes de correo que rompen
      // el threading (Outlook viejo, móvil, reenvíos…).
      if (!thread && direction === "inbound" && from) {
        thread = await findThreadByParticipant(from, ownEmails);
        if (thread) {
          console.log(`[email-inbox] match por participante: ${from} → ${thread.id} (${thread.subject})`);
        }
      }
      // Fallback amplio para OUTBOUND: si yo envío a alguien con quien
      // tengo hilo abierto, lo adjuntamos (cubre cuando envío desde Gmail
      // directamente sin pasar por la plataforma).
      if (!thread && direction === "outbound" && to.length > 0) {
        for (const dst of to) {
          thread = await findThreadByParticipant(dst, ownEmails);
          if (thread) {
            console.log(`[email-inbox] match outbound por participante: ${dst} → ${thread.id}`);
            break;
          }
        }
      }

      // FILTRO ESTRICTO: el sync NUNCA crea hilos nuevos.
      // Los hilos sólo se crean cuando el usuario hace:
      //   - "+ Nuevo" (compose) → /api/email/send crea el thread
      //   - 🔎 Buscar e importar → /api/email/import crea el thread
      // Si no hay match con un hilo existente del usuario → SKIP.
      // Esto garantiza que nunca aparezcan contactos que no buscó manualmente.
      if (!thread) {
        continue;
      }
      // Si hicimos match con un hilo existente, aceptamos el mensaje siempre.
      // Antes había un filtro adicional `watched !== true` que se cargaba
      // respuestas legítimas a hilos antiguos creados sin ese flag.

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
            await updateFollowup(thread.id, f.id, {
              status: "cancelled",
              cancelled_reason: "prospect_replied",
              cancelled_at: new Date().toISOString(),
            });
          }
        }
      }

      // Si fue un OUTBOUND nuevo descubierto en Sent (= el usuario podría haber
      // respondido manualmente desde su cliente de correo), CUIDADO con cancelar.
      //
      // REGLA CONSERVADORA (evita destruir follow-ups programados deliberadamente):
      //   - SÓLO cancelar follow-ups con status='pending_approval' Y origin='ai_auto'
      //     (= borradores que el autopilot generó esperando aprobación;
      //      el usuario ya respondió, así que esos drafts son obsoletos).
      //   - NUNCA cancelar status='scheduled' aquí. Los scheduled fueron
      //     programados deliberadamente por el usuario (drip secuencial),
      //     y deben respetarse aunque el usuario haya respondido manualmente
      //     a un mensaje intermedio. Sólo se cancelan si el PROSPECT responde.
      if (direction === "outbound") {
        for (const f of thread.followups) {
          if (f.status === "pending_approval" && f.origin === "ai_auto") {
            await updateFollowup(thread.id, f.id, {
              status: "cancelled",
              cancelled_reason: "user_replied_manually",
              cancelled_at: new Date().toISOString(),
            });
            console.log(`[email-inbox] cancelado autopilot draft ${f.id} — respuesta manual del usuario`);
          }
        }
        // Marcar inbounds como "procesados" por el autopilot para que no
        // genere borradores duplicados sobre algo que ya respondiste.
        const ids = [...(thread.auto_pilot_processed_msg_ids ?? [])];
        let changed = false;
        for (const m of thread.messages) {
          if (m.direction === "inbound" && m.message_id && !ids.includes(m.message_id)) {
            ids.push(m.message_id);
            changed = true;
          }
        }
        if (changed) {
          await import("./email-threads").then(({ updateThread }) =>
            updateThread(thread!.id, { auto_pilot_processed_msg_ids: ids })
          );
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

    // Detectar carpetas. Incluimos también la carpeta Sent para detectar
    // respuestas manuales del usuario (envíos desde Gmail directamente, no
    // desde la plataforma). El sync las marca como outbound y cancela
    // borradores del autopilot.
    const folders: string[] = [];
    try {
      const list = await client.list();
      if (list.find(m => /^inbox$/i.test(m.path))) folders.push("INBOX");
      const sent = list.find(m =>
        m.specialUse === "\\Sent" ||
        /\[Gmail\]\/Sent Mail/i.test(m.path) ||
        /\[Gmail\]\/Enviados/i.test(m.path) ||
        /^Sent$/i.test(m.path) ||
        /^Enviados$/i.test(m.path)
      );
      if (sent) folders.push(sent.path);
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
          // 1) Búsqueda PRIORITARIA por participante activo (rápida, pocos UIDs).
          //    Buscamos tanto FROM (prospect → yo, en INBOX/All Mail) como TO
          //    (yo → prospect, en Sent/All Mail) para detectar las dos direcciones.
          const targetedUids: number[] = [];
          for (const addr of watchedAddrs) {
            try {
              const fromUids = (await client.search({ from: addr } as any, { uid: true })) ?? [];
              targetedUids.push(...fromUids);
            } catch (e: any) {
              console.warn(`[email-inbox] from search ${addr} failed:`, e.message);
            }
            try {
              const toUids = (await client.search({ to: addr } as any, { uid: true })) ?? [];
              targetedUids.push(...toUids);
            } catch (e: any) {
              console.warn(`[email-inbox] to search ${addr} failed:`, e.message);
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

  // Liberar referencias antes de salir
  knownMsgIds.clear();
  if (typeof (global as any).gc === "function") {
    try { (global as any).gc(); } catch {}
  }

  return { fetched: totalFetched, new_messages: totalNew, threads_touched: [...threadsTouched], error };
}

/**
 * DEEP REFRESH: para cada hilo abierto, busca en IMAP todos los mensajes
 * intercambiados con los participantes (FROM ellos + TO ellos, todas las
 * carpetas) y adjunta los que falten al hilo correspondiente. Reusa una sola
 * conexión IMAP para todos los hilos para ser eficiente.
 *
 * Esto es el equivalente a llamar /api/email/sync-thread para cada hilo, pero
 * más eficiente porque comparte la conexión.
 */
export async function deepRefreshAllThreads(opts: {
  days?: number;
  maxThreads?: number;
} = {}): Promise<{ threads_refreshed: number; new_messages: number; errors: number }> {
  const days = opts.days ?? 60;
  // Reducido de 100 a 40 para evitar OOM en cuentas con muchos hilos.
  const maxThreads = opts.maxThreads ?? 40;
  // Tope duro de UIDs procesados por folder para acotar memoria
  const MAX_UIDS_PER_FOLDER = 300;

  const cfg = await readEmailConfig();
  if (!cfg) return { threads_refreshed: 0, new_messages: 0, errors: 0 };

  const allThreads = await listThreads();
  const openThreads = allThreads
    .filter((t) => t.status !== "closed")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, maxThreads);

  if (openThreads.length === 0) return { threads_refreshed: 0, new_messages: 0, errors: 0 };

  const ownEmails = new Set<string>([
    cfg.email.toLowerCase(),
    ...((cfg as any).send_aliases ?? []).map((a: string) => String(a).toLowerCase()),
  ]);

  // Mapa: address normalizada → array de threads que la incluyen
  const addrToThreads = new Map<string, typeof openThreads>();
  for (const t of openThreads) {
    for (const p of t.participants) {
      const addr = String(p).toLowerCase().trim();
      if (!addr || ownEmails.has(addr)) continue;
      if (!addrToThreads.has(addr)) addrToThreads.set(addr, []);
      addrToThreads.get(addr)!.push(t);
    }
  }

  // knownMsgIds globales (todos los hilos)
  const knownMsgIds = new Set<string>();
  for (const t of allThreads) {
    for (const m of t.messages) {
      const id = normMsgId(m.message_id);
      if (id) knownMsgIds.add(id);
    }
  }

  let totalNew = 0;
  let errors = 0;

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
  (client as any).on?.("error", (err: any) => {
    console.warn("[deep-refresh] imap socket error:", err?.message || err);
  });

  try {
    await client.connect();
    const folderList = await client.list();
    const folders: string[] = [];
    const inbox = folderList.find((m) => /^inbox$/i.test(m.path));
    if (inbox) folders.push(inbox.path);
    const sent = folderList.find((m) =>
      m.specialUse === "\\Sent" ||
      /\[Gmail\]\/Sent Mail/i.test(m.path) ||
      /\[Gmail\]\/Enviados/i.test(m.path)
    );
    if (sent) folders.push(sent.path);
    const allMail = folderList.find((m) =>
      m.specialUse === "\\All" ||
      /\[Gmail\]\/All Mail/i.test(m.path) ||
      /\[Gmail\]\/Todos/i.test(m.path)
    );
    if (allMail) folders.push(allMail.path);
    const spam = folderList.find((m) =>
      m.specialUse === "\\Junk" ||
      /\[Gmail\]\/Spam/i.test(m.path) ||
      /\[Gmail\]\/Correo no deseado/i.test(m.path)
    );
    if (spam) folders.push(spam.path);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    for (const folder of folders) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          // Acumular todos los UIDs que matchean cualquier contacto
          const uidsCollected = new Set<number>();
          for (const addr of addrToThreads.keys()) {
            try {
              const fromUids = (await client.search({ from: addr, since } as any, { uid: true })) ?? [];
              fromUids.forEach((u) => uidsCollected.add(u));
            } catch {}
            try {
              const toUids = (await client.search({ to: addr, since } as any, { uid: true })) ?? [];
              toUids.forEach((u) => uidsCollected.add(u));
            } catch {}
          }
          // Sort y limitar para tope memoria — más recientes primero
          const uids = Array.from(uidsCollected).sort((a, b) => b - a).slice(0, MAX_UIDS_PER_FOLDER);
          uidsCollected.clear(); // liberar el Set
          if (uids.length === 0) continue;

          for (const uid of uids) {
            try {
              const full = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
              if (!full) continue;
              const parsed = _hasMailparser && full.source ? await simpleParser(full.source) : null;
              const messageId = normMsgId(parsed?.messageId ?? (full.envelope as any)?.messageId);
              if (!messageId || knownMsgIds.has(messageId)) {
                // Liberar parsed/source aunque hagamos skip
                (full as any).source = null;
                continue;
              }

              const fromAddr = String(parsed?.from?.value?.[0]?.address ?? "").toLowerCase();
              const toAddrsRaw = (parsed?.to as any)?.value ?? [];
              const toAddrs = (Array.isArray(toAddrsRaw) ? toAddrsRaw : [])
                .map((a: any) => String(a.address || "").toLowerCase())
                .filter(Boolean);
              const direction: "inbound" | "outbound" = ownEmails.has(fromAddr) ? "outbound" : "inbound";

              // Determinar a qué thread asociar:
              //   inbound: por fromAddr
              //   outbound: por cualquier toAddr que esté en addrToThreads
              let candidateAddrs: string[] = [];
              if (direction === "inbound") {
                candidateAddrs = [fromAddr];
              } else {
                candidateAddrs = toAddrs.filter((a) => addrToThreads.has(a));
              }
              if (candidateAddrs.length === 0) continue;

              for (const addr of candidateAddrs) {
                const candidates = addrToThreads.get(addr);
                if (!candidates || candidates.length === 0) continue;
                // Elegir el thread más reciente con este contacto
                const t = candidates.sort(
                  (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                )[0];

                await appendMessage(t.id, {
                  direction,
                  from: fromAddr,
                  to: toAddrs,
                  subject: parsed?.subject ?? t.subject,
                  body_html: parsed?.html || undefined,
                  body_text: parsed?.text || undefined,
                  message_id: messageId,
                  in_reply_to: normMsgId(parsed?.inReplyTo) || undefined,
                  references: parsed?.references
                    ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references])
                        .map((r: any) => normMsgId(r))
                        .filter(Boolean)
                    : undefined,
                  date: (full.internalDate ?? new Date()).toISOString(),
                });
                knownMsgIds.add(messageId);
                totalNew++;

                // Cancelar follow-ups si aplica
                if (direction === "inbound") {
                  for (const f of t.followups) {
                    if (f.status === "scheduled" || f.status === "pending_approval") {
                      await updateFollowup(t.id, f.id, {
                        status: "cancelled",
                        cancelled_reason: "prospect_replied",
                        cancelled_at: new Date().toISOString(),
                      });
                    }
                  }
                } else if (direction === "outbound") {
                  // Usuario respondió manualmente -> cancelar SOLO borradores
                  // del autopilot (pending_approval ai_auto). Los drips
                  // programados explícitamente se respetan.
                  for (const f of t.followups) {
                    if (f.status === "pending_approval" && f.origin === "ai_auto") {
                      await updateFollowup(t.id, f.id, {
                        status: "cancelled",
                        cancelled_reason: "user_replied_manually",
                        cancelled_at: new Date().toISOString(),
                      });
                    }
                  }
                }
                break; // sólo añadir a UN thread
              }
            } catch (e: any) {
              errors++;
              console.warn(`[deep-refresh] uid ${uid} en ${folder}: ${e.message}`);
            }
          }
        } finally {
          lock.release();
        }
      } catch (e: any) {
        errors++;
        console.warn(`[deep-refresh] folder ${folder}: ${e.message}`);
      }
    }
    // ====================================================================
    // AUTO-DISCOVER: busca conversaciones bidireccionales con contactos
    // que aún NO tienen hilo en la plataforma. Filtra spam/newsletters.
    // ====================================================================
    let autoCreated = 0;
    try {
      const inboxFolder = folderList.find((m) => /^inbox$/i.test(m.path));
      if (inboxFolder) {
        const lock = await client.getMailboxLock(inboxFolder.path);
        try {
          // Inbound recientes (14 días)
          const since14 = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
          const recentUids: number[] = (await client.search({ since: since14 } as any, { uid: true })) ?? [];
          // Limitar a los últimos 80 para no saturar
          const limited = recentUids.sort((a, b) => b - a).slice(0, 80);

          // Pre-construir set de contactos ya conocidos (en addrToThreads)
          const knownContacts = new Set<string>(addrToThreads.keys());
          // También considerar todos los participants de TODOS los threads (incluso cerrados)
          for (const t of allThreads) {
            for (const p of t.participants) {
              const addr = String(p).toLowerCase().trim();
              if (addr && !ownEmails.has(addr)) knownContacts.add(addr);
            }
          }

          const candidatesByAddr = new Map<string, { uid: number; parsed: any; full: any }>();
          for (const uid of limited) {
            try {
              const full = await client.fetchOne(uid, { source: true, envelope: true, internalDate: true }, { uid: true });
              if (!full) continue;
              const parsed = _hasMailparser && full.source ? await simpleParser(full.source) : null;
              if (!parsed) continue;
              const messageId = normMsgId(parsed.messageId ?? "");
              if (!messageId || knownMsgIds.has(messageId)) continue;
              const fromAddr = String(parsed.from?.value?.[0]?.address ?? "").toLowerCase();
              if (!fromAddr || ownEmails.has(fromAddr)) continue;
              if (knownContacts.has(fromAddr)) continue;
              // Filtros antispam/newsletter
              if (isNoiseAddress(fromAddr) || isNoiseSubject(parsed.subject || "")) continue;
              // Solo un candidato por dirección (el más reciente)
              if (!candidatesByAddr.has(fromAddr)) {
                candidatesByAddr.set(fromAddr, { uid, parsed, full });
              }
            } catch {}
          }
          lock.release();

          // Para cada candidato, verificar en Sent que tenemos al menos 1 email TO ellos
          const sentFolder = folderList.find((m) =>
            m.specialUse === "\\Sent" || /\[Gmail\]\/Sent Mail/i.test(m.path) || /\[Gmail\]\/Enviados/i.test(m.path)
          );
          if (sentFolder && candidatesByAddr.size > 0) {
            const sentLock = await client.getMailboxLock(sentFolder.path);
            try {
              for (const [addr, cand] of candidatesByAddr) {
                try {
                  const sentToUids = (await client.search({ to: addr } as any, { uid: true })) ?? [];
                  if (sentToUids.length === 0) continue; // nunca le hemos escrito → no es un prospect nuestro

                  // Conversación bidireccional confirmada → crear thread
                  const contactName = (cand.parsed.from?.value?.[0]?.name as string) || addr.split("@")[0];
                  const subject = (cand.parsed.subject as string) || "(sin asunto)";

                  const newThread = await createThread({
                    subject,
                    participants: [cfg.email.toLowerCase(), addr],
                    contact_email: addr,
                    contact_name: contactName,
                  });
                  // Marcar como watched
                  await updateThread(newThread.id, { watched: true } as any);

                  // Adjuntar el inbound que encontramos
                  const inMsgId = normMsgId(cand.parsed.messageId ?? "");
                  const inboundDate = (cand.full.internalDate ?? new Date()).toISOString();
                  const inboundTos = ((cand.parsed.to as any)?.value ?? [])
                    .map((a: any) => String(a.address || "").toLowerCase())
                    .filter(Boolean);
                  await appendMessage(newThread.id, {
                    direction: "inbound",
                    from: addr,
                    to: inboundTos,
                    subject,
                    body_html: cand.parsed.html || undefined,
                    body_text: cand.parsed.text || undefined,
                    message_id: inMsgId,
                    in_reply_to: normMsgId(cand.parsed.inReplyTo) || undefined,
                    references: cand.parsed.references
                      ? (Array.isArray(cand.parsed.references) ? cand.parsed.references : [cand.parsed.references]).map((r: any) => normMsgId(r)).filter(Boolean)
                      : undefined,
                    date: inboundDate,
                  });
                  knownMsgIds.add(inMsgId);

                  // Y adjuntar el último outbound del Sent (para que la conversación se vea completa)
                  try {
                    const lastSentUid = Math.max(...sentToUids);
                    const sentFull = await client.fetchOne(lastSentUid, { source: true, envelope: true, internalDate: true }, { uid: true });
                    if (sentFull) {
                      const sentParsed = await simpleParser(sentFull.source as any);
                      const sentMid = normMsgId(sentParsed.messageId ?? "");
                      if (sentMid && !knownMsgIds.has(sentMid)) {
                        const sentTos = ((sentParsed.to as any)?.value ?? [])
                          .map((a: any) => String(a.address || "").toLowerCase())
                          .filter(Boolean);
                        await appendMessage(newThread.id, {
                          direction: "outbound",
                          from: String(sentParsed.from?.value?.[0]?.address ?? cfg.email).toLowerCase(),
                          to: sentTos,
                          subject: (sentParsed.subject as string) || subject,
                          body_html: sentParsed.html || undefined,
                          body_text: sentParsed.text || undefined,
                          message_id: sentMid,
                          in_reply_to: normMsgId(sentParsed.inReplyTo) || undefined,
                          references: sentParsed.references
                            ? (Array.isArray(sentParsed.references) ? sentParsed.references : [sentParsed.references]).map((r: any) => normMsgId(r)).filter(Boolean)
                            : undefined,
                          date: (sentFull.internalDate ?? new Date()).toISOString(),
                        });
                        knownMsgIds.add(sentMid);
                      }
                    }
                  } catch {}

                  autoCreated++;
                  totalNew += 2; // estimación

                  // Añadir a addrToThreads para que el siguiente ciclo lo cubra
                  addrToThreads.set(addr, [newThread as any]);
                  console.log(`[deep-refresh] AUTO-IMPORT: ${addr} (${contactName}) — conversación bidireccional creada`);
                } catch (e: any) {
                  console.warn(`[deep-refresh] auto-import ${addr} falló:`, e.message);
                }
              }
            } finally {
              sentLock.release();
            }
          }
        } catch (e: any) {
          console.warn("[deep-refresh] auto-discover error:", e.message);
        }
      }
    } catch (e: any) {
      console.warn("[deep-refresh] auto-discover fatal:", e.message);
    }

    await client.logout();
  } catch (e: any) {
    errors++;
    console.error("[deep-refresh] fatal:", e.message);
  }

  if (totalNew > 0) {
    console.log(`[deep-refresh] ✓ ${totalNew} mensajes nuevos en ${openThreads.length} hilos refrescados`);
  }

  // Liberar referencias grandes y sugerir GC si está disponible (--expose-gc)
  knownMsgIds.clear();
  addrToThreads.clear();
  if (typeof (global as any).gc === "function") {
    try { (global as any).gc(); } catch {}
  }

  return { threads_refreshed: openThreads.length, new_messages: totalNew, errors };
}

/** Detecta direcciones noreply/automáticas */
function isNoiseAddress(addr: string): boolean {
  return /(?:^|@|\.)(no.?reply|noreply|donotreply|do-not-reply|mailer-daemon|postmaster|notification|notifications|alert|alerts|bounces?|mailer|info-|news|newsletter|hello|support|automated|automation|system|webmaster|admin@google\.com|robot|googlecommunityteam)/i.test(addr);
}

/** Detecta asuntos de spam/automatizados típicos */
function isNoiseSubject(subj: string): boolean {
  return /(?:undelivered|delivery status|out of office|automatic reply|auto.?response|fuera de la oficina|respuesta automática|invitation\.ics|calendar invite|google calendar|mailer-daemon|account security|password|verification code|código de verificación|mensaje del sistema)/i.test(subj);
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
