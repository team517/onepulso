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
  isBounceOrFailure,
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
  let maxUidSeen = account.last_uid_inbox || 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const msgsMap = await loadMessagesMap(uniboxId);
      const existing = msgsMap[accountId] || [];
      const existingUids = new Set(existing.map((m) => String(m.uid)));

      const status = await client.status("INBOX", { messages: true, uidNext: true });
      const total = status.messages || 0;
      if (total === 0) {
        accs[idx].last_sync = new Date().toISOString();
        accs[idx].last_error = null;
        await saveAccounts(uniboxId, accs);
        await client.logout();
        return 0;
      }

      // SYNC INCREMENTAL si ya tenemos last_uid_inbox Y el cache tiene
      // suficiente histórico (>= 80% del total IMAP).
      // FULL SYNC automático si:
      //   - es la primera vez (last_uid_inbox == 0)
      //   - O el cache tiene MUCHO menos que IMAP (cache < 80% de total)
      //     → significa que faltan mensajes históricos
      // Esto garantiza que sin pulsar 'Forzar resync', el usuario siempre
      // ve TODO el histórico tras una sync.
      const lastUid = account.last_uid_inbox || 0;
      const cachedCount = existing.length;
      const cacheCompleteEnough = cachedCount >= total * 0.8;
      let range: string;
      let isIncremental = false;
      if (lastUid > 0 && cacheCompleteEnough) {
        // Cache OK + UID guardado → incremental rápido
        range = `${lastUid + 1}:*`;
        isIncremental = true;
      } else {
        // Cache vacío o incompleto → descarga TODOS los mensajes del INBOX
        if (lastUid > 0 && !cacheCompleteEnough) {
          console.log(`[unibox-sync] ${account.email}: cache=${cachedCount} pero IMAP=${total} → auto full sync`);
        }
        range = `1:*`;
      }

      console.log(`[unibox-sync] ${account.email}: ${isIncremental ? `incremental UID > ${lastUid}` : `inicial seq ${range}`} (UIDNEXT=${status.uidNext}, total=${total})`);

      const fresh: UniboxMessage[] = [];
      let fetched = 0;
      let skippedDupe = 0;
      let skippedFilter = 0;
      let parseErrors = 0;
      // Cuando es incremental usamos UID FETCH (rango ya está en formato UID:UID).
      // Sin incremental, usamos sequence-number FETCH normal.
      const fetcher = isIncremental
        ? client.fetch(range, { envelope: true, source: true, uid: true, flags: true }, { uid: true })
        : client.fetch(range, { envelope: true, source: true, uid: true, flags: true });
      for await (const msg of fetcher) {
        fetched++;
        const uidStr = String(msg.uid);

        // CRITICAL: NO avanzamos maxUidSeen aquí. Sólo cuando el mensaje
        // se ha procesado con éxito (o filtrado intencionalmente). Si el
        // parseo falla, queremos que el próximo sync lo reintente.

        if (existingUids.has(uidStr)) {
          // Ya está en cache — avanzamos UID porque sabemos que existe.
          if (msg.uid && msg.uid > maxUidSeen) maxUidSeen = msg.uid;
          skippedDupe++;
          continue;
        }

        // Datos del envelope (siempre disponibles, no fallan).
        const envelope = (msg.envelope as any) || {};
        const envSubject = envelope.subject || "(sin asunto)";
        const envFromAddr = envelope.from?.[0]?.address || "";
        const envFromName = envelope.from?.[0]?.name || "";
        const envToAddr = envelope.to?.[0]?.address || "";
        const envDate = envelope.date ? new Date(envelope.date).toISOString() : new Date().toISOString();
        const envMessageId = envelope.messageId || "";
        const envInReplyTo = envelope.inReplyTo || "";

        // Intentamos parsear el cuerpo completo. Si falla, hacemos fallback
        // con datos del envelope — el mensaje aparece en la bandeja
        // aunque sin cuerpo (mejor que perderlo).
        let parsed: any = null;
        if (msg.source) {
          try {
            parsed = await simpleParser(msg.source);
          } catch (parseErr: any) {
            parseErrors++;
            console.warn(`[unibox-sync] ${account.email} UID ${msg.uid}: parse error (${parseErr?.message || parseErr}). Usando fallback envelope.`);
          }
        } else {
          parseErrors++;
          console.warn(`[unibox-sync] ${account.email} UID ${msg.uid}: msg.source vacío. Usando fallback envelope.`);
        }

        const subject = parsed?.subject || envSubject;
        const text = parsed?.text || "";
        const html = (parsed?.html as string) || "";
        const fromAddr = parsed?.from?.text || envFromAddr;
        const fromName = envFromName;
        const fromAddress = envFromAddr;
        const warmup = isWarmupMessage({ subject, text, html, from: fromAddr });

        // FILTRO BOUNCE
        if (isBounceOrFailure({ from: fromAddr, fromAddress, fromName, subject, text })) {
          if (msg.uid && msg.uid > maxUidSeen) maxUidSeen = msg.uid;
          skippedFilter++;
          continue;
        }

        const wrap = (s: string): string => {
          const t = String(s || "").trim();
          if (!t) return "";
          const cleaned = t.replace(/^<+|>+$/g, "");
          return cleaned ? `<${cleaned}>` : "";
        };
        const messageId = wrap(parsed?.messageId || envMessageId);
        const inReplyTo = wrap((parsed?.inReplyTo as string) || envInReplyTo);
        const refsRaw = parsed?.references;
        const refsArr = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];
        const references = refsArr.map(wrap).filter(Boolean);

        // Preview: usa text del parsed, o si falló, intenta extraer del HTML,
        // o como último fallback subject.
        const previewText = text || (html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");

        fresh.push({
          uid: msg.uid,
          messageId,
          inReplyTo,
          references,
          from: fromAddr,
          fromName,
          fromAddress,
          to: parsed?.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text).join(", ") : parsed.to.text) : envToAddr,
          toAddress: envToAddr,
          subject,
          date: (parsed?.date ? new Date(parsed.date).toISOString() : envDate),
          preview: previewText.slice(0, 180),
          text,
          html,
          unread: !(msg.flags && msg.flags.has("\\Seen")),
          is_warmup: warmup,
          attachments: (parsed?.attachments || []).map((a: any) => ({
            filename: a.filename || "",
            contentType: a.contentType || "",
            size: a.size || 0,
          })),
        });
        // SOLO avanzar maxUidSeen tras añadir el mensaje al cache.
        if (msg.uid && msg.uid > maxUidSeen) maxUidSeen = msg.uid;
        newCount++;
      }
      console.log(`[unibox-sync] ${account.email}: fetched=${fetched} new=${newCount} dupe=${skippedDupe} filtered=${skippedFilter} parseErr=${parseErrors}`);

      // Mantener cache de 5000 mensajes (antes 2000). Histórico amplio
      // para uniboxes con campañas grandes y respuestas multi-idioma.
      msgsMap[accountId] = [...fresh, ...existing].slice(0, 50000);
      await saveMessagesMap(uniboxId, msgsMap);
      if (newCount > 0) {
        console.log(`[unibox-sync] ${account.email}: ${newCount} mensajes nuevos en INBOX`);
      }
    } finally {
      lock.release();
    }
    await client.logout();
    accs[idx].last_sync = new Date().toISOString();
    accs[idx].last_error = null;
    // Guardamos el max UID visto — próximo sync arranca de aquí.
    if (maxUidSeen > (accs[idx].last_uid_inbox || 0)) {
      accs[idx].last_uid_inbox = maxUidSeen;
    }
    await saveAccounts(uniboxId, accs);
    return newCount;
  } catch (e: any) {
    const errMsg = e.message || String(e);
    accs[idx].last_error = errMsg;
    await saveAccounts(uniboxId, accs);
    console.warn(`[unibox-sync] ✗ ${account.email}: ${errMsg}`);
    try { await client.logout(); } catch {}
    throw e;
  }
}

/**
 * Fuerza un sync completo de una cuenta resetando last_uid_inbox y
 * last_uid_sent a 0. La próxima sync (o este mismo call si lo invocas
 * justo después) traerá los últimos 1500 mensajes desde cero, ignorando
 * el estado incremental. Útil cuando el cliente cree que faltan mensajes.
 */
export async function forceFullResync(uniboxId: string, accountId: string): Promise<{ inbox: number; sent: number }> {
  const accs = await listAccounts(uniboxId);
  const idx = accs.findIndex((a) => a.id === accountId);
  if (idx === -1) return { inbox: 0, sent: 0 };
  accs[idx].last_uid_inbox = 0;
  accs[idx].last_uid_sent = 0;
  await saveAccounts(uniboxId, accs);
  console.log(`[unibox-sync] forceFullResync: ${accs[idx].email} → UIDs reseteados`);
  const inboxN = await syncAccount(uniboxId, accountId).catch(() => 0);
  const sentN = await syncAccountSent(uniboxId, accountId).catch(() => 0);
  return { inbox: inboxN, sent: sentN };
}

/** Sincroniza también la carpeta Sent (envíos del propio usuario) — opcional, no falla si no existe. */
export async function syncAccountSent(uniboxId: string, accountId: string): Promise<number> {
  const accs = await listAccounts(uniboxId);
  const idx = accs.findIndex((a) => a.id === accountId);
  if (idx === -1) return 0;
  const account = accs[idx];

  const imapPort = account.imap_port || 993;
  const client = new ImapFlow({
    host: account.imap_host,
    port: imapPort,
    secure: imapPort === 993 || imapPort === 995,
    auth: { user: account.imap_user || account.email, pass: account.imap_pass },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  let newCount = 0;
  let maxUidSentSeen = account.last_uid_sent || 0;
  try {
    await client.connect();
    // Buscar carpeta Sent (gmail: [Gmail]/Sent Mail, IMAP genérico: Sent)
    const list = await client.list();
    const sentFolder = list.find((m: any) =>
      m.specialUse === "\\Sent" ||
      /\[Gmail\]\/Sent Mail/i.test(m.path) ||
      /\[Gmail\]\/Enviados/i.test(m.path) ||
      /^Sent$/i.test(m.path) ||
      /^Enviados$/i.test(m.path)
    );
    if (!sentFolder) { await client.logout(); return 0; }

    const lock = await client.getMailboxLock(sentFolder.path);
    try {
      const msgsMap = await loadMessagesMap(uniboxId);
      const existing = msgsMap[accountId] || [];
      const existingUids = new Set(existing.map((m) => String(m.uid)));

      const status = await client.status(sentFolder.path, { messages: true, uidNext: true });
      const total = status.messages || 0;
      if (total === 0) { await client.logout(); return 0; }

      // SYNC INCREMENTAL para Sent — mismo patrón auto-detección que INBOX.
      const lastSentUid = account.last_uid_sent || 0;
      // Contamos solo los Sent del cache (UID negativos)
      const cachedSentCount = existing.filter((m) => m.uid < 0).length;
      const sentCacheCompleteEnough = cachedSentCount >= total * 0.8;
      let range: string;
      let isIncrementalSent = false;
      if (lastSentUid > 0 && sentCacheCompleteEnough) {
        range = `${lastSentUid + 1}:*`;
        isIncrementalSent = true;
      } else {
        if (lastSentUid > 0 && !sentCacheCompleteEnough) {
          console.log(`[unibox-sync sent] ${account.email}: cache=${cachedSentCount} pero IMAP=${total} → auto full sync`);
        }
        range = `1:*`;
      }

      const fresh: UniboxMessage[] = [];
      const fetcher = isIncrementalSent
        ? client.fetch(range, { envelope: true, source: true, uid: true, flags: true }, { uid: true })
        : client.fetch(range, { envelope: true, source: true, uid: true, flags: true });
      for await (const msg of fetcher) {
        // Para Sent guardamos UIDs como negativos en el cache para no colisionar
        // con INBOX. NO avanzamos maxUidSentSeen hasta procesar con éxito.
        const uidPseudo = -1 * msg.uid; // negative UIDs identifican Sent
        const uidStr = String(uidPseudo);
        if (existingUids.has(uidStr)) {
          if (msg.uid && msg.uid > maxUidSentSeen) maxUidSentSeen = msg.uid;
          continue;
        }

        const envelope = (msg.envelope as any) || {};
        const envSubject = envelope.subject || "(sin asunto)";
        const envFromAddr = envelope.from?.[0]?.address || "";
        const envFromName = envelope.from?.[0]?.name || "";
        const envToAddr = envelope.to?.[0]?.address || "";
        const envDate = envelope.date ? new Date(envelope.date).toISOString() : new Date().toISOString();
        const envMessageId = envelope.messageId || "";
        const envInReplyTo = envelope.inReplyTo || "";

        let parsed: any = null;
        if (msg.source) {
          try { parsed = await simpleParser(msg.source); }
          catch (parseErr: any) {
            console.warn(`[unibox-sync sent] ${account.email} UID ${msg.uid}: parse error (${parseErr?.message}). Fallback envelope.`);
          }
        }

        const subject = parsed?.subject || envSubject;
        const text = parsed?.text || "";
        const html = (parsed?.html as string) || "";
        const fromAddr = parsed?.from?.text || envFromAddr;
        const fromName = envFromName;
        const fromAddress = envFromAddr;
        if (isBounceOrFailure({ from: fromAddr, fromAddress, fromName, subject, text })) {
          if (msg.uid && msg.uid > maxUidSentSeen) maxUidSentSeen = msg.uid;
          continue;
        }
        const warmup = isWarmupMessage({ subject, text, html, from: fromAddr });
        const wrap = (s: string): string => {
          const t = String(s || "").trim();
          if (!t) return "";
          const cleaned = t.replace(/^<+|>+$/g, "");
          return cleaned ? `<${cleaned}>` : "";
        };
        const messageId = wrap(parsed?.messageId || envMessageId);
        const inReplyTo = wrap((parsed?.inReplyTo as string) || envInReplyTo);
        const refsRaw = parsed?.references;
        const refsArr = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];
        const references = refsArr.map(wrap).filter(Boolean);
        const previewText = text || (html ? html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");
        fresh.push({
          uid: uidPseudo,
          messageId,
          inReplyTo,
          references,
          from: fromAddr,
          fromName,
          fromAddress,
          to: parsed?.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text).join(", ") : parsed.to.text) : envToAddr,
          toAddress: envToAddr,
          subject,
          date: parsed?.date ? new Date(parsed.date).toISOString() : envDate,
          preview: previewText.slice(0, 180),
          text,
          html,
          unread: false,
          is_warmup: warmup,
          attachments: (parsed?.attachments || []).map((a: any) => ({ filename: a.filename || "", contentType: a.contentType || "", size: a.size || 0 })),
        } as any);
        (fresh[fresh.length - 1] as any).is_sent = true;
        if (msg.uid && msg.uid > maxUidSentSeen) maxUidSentSeen = msg.uid;
        newCount++;
      }
      // Cap total subido a 5000 (antes 2000). Alineado con INBOX cap para
      // conservar histórico completo de respuestas en campañas grandes.
      msgsMap[accountId] = [...fresh, ...existing].slice(0, 50000);
      await saveMessagesMap(uniboxId, msgsMap);
      if (newCount > 0) {
        console.log(`[unibox-sync] ${account.email}: ${newCount} mensajes nuevos en SENT`);
      }
    } finally { lock.release(); }
    await client.logout();
    // Guardar max UID Sent visto para próximo sync incremental.
    if (maxUidSentSeen > (accs[idx].last_uid_sent || 0)) {
      accs[idx].last_uid_sent = maxUidSentSeen;
      await saveAccounts(uniboxId, accs);
    }
  } catch (e) {
    try { await client.logout(); } catch {}
  }
  return newCount;
}

/** Sincroniza todas las cuentas de una unibox EN PARALELO con concurrencia limitada.
 *  Antes era secuencial — con 25 cuentas tardaba minutos. Ahora paralelo en lotes
 *  de 5 simultáneos para no saturar memoria. */
export async function syncUnibox(uniboxId: string): Promise<{ ok: number; fail: number; new: number }> {
  const accs = await listAccounts(uniboxId);
  let ok = 0, fail = 0, total = 0;

  // 10 cuentas en paralelo (antes 5). IMAP soporta bien múltiples conexiones
  // simultáneas si son a hosts distintos. Si son al mismo host (ej. todas en
  // Gmail), Gmail tolera bien hasta ~15-20 conexiones por cuenta de usuario.
  const CONCURRENCY = 10;
  for (let i = 0; i < accs.length; i += CONCURRENCY) {
    const batch = accs.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (a) => {
        // INBOX y Sent EN PARALELO dentro de cada cuenta — usan conexiones IMAP
        // distintas, no compiten. Antes era serial → 2x latencia.
        const [inboxNew, sentNew] = await Promise.all([
          syncAccount(uniboxId, a.id).catch(() => 0),
          syncAccountSent(uniboxId, a.id).catch(() => 0),
        ]);
        return inboxNew + sentNew;
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        ok++;
        total += r.value;
      } else {
        fail++;
      }
    }
  }

  await updateUnibox(uniboxId, { last_sync: new Date().toISOString() });

  // Re-clasificar SIEMPRE tras sync: la detección de warmup evoluciona y los
  // mensajes guardados con algoritmo antiguo se quedaban con is_warmup=false.
  // Re-aplicarlo a la caché entera mantiene la bandeja limpia siempre.
  try {
    const r = await reclassifyMessages(uniboxId);
    if (r.warmup > 0) {
      console.log(`[unibox-sync] ${uniboxId}: reclasificación → ${r.warmup}/${r.total} marcados como warmup`);
    }
  } catch (e: any) {
    console.warn(`[unibox-sync] ${uniboxId}: reclassify failed:`, e.message);
  }

  if (total > 0) console.log(`[unibox-sync] ${uniboxId}: ${total} mensajes nuevos · ${ok} cuentas OK · ${fail} con error`);
  return { ok, fail, new: total };
}

/** Sincroniza TODAS las uniboxes existentes en PARALELO. Usado por el scheduler.
 *  Antes era secuencial → con 3 uniboxes tardaba 3× más.
 *  Ahora paralelo con concurrencia 3 (3 uniboxes a la vez como máximo). */
export async function syncAllUniboxes(): Promise<{ uniboxes: number; total_new: number; errors: number }> {
  const { listUniboxes } = await import("./unibox-store");
  const all = await listUniboxes();
  let totalNew = 0;
  let errors = 0;

  const PARALLEL_UNIBOXES = 3;
  for (let i = 0; i < all.length; i += PARALLEL_UNIBOXES) {
    const batch = all.slice(i, i + PARALLEL_UNIBOXES);
    const results = await Promise.allSettled(batch.map((u) => syncUnibox(u.id)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        totalNew += r.value.new;
      } else {
        errors++;
      }
    }
  }
  return { uniboxes: all.length, total_new: totalNew, errors };
}

/** Reclasifica todos los mensajes cacheados:
 *  - Re-aplica isWarmupMessage() para marcar warmup.
 *  - Re-aplica isBounceOrFailure() para BORRAR mensajes que matcheen
 *    (bounces, "test email to check account status", etc.) — la lista
 *    de patrones ha crecido con el tiempo y los antiguos se han de limpiar.
 */
export async function reclassifyMessages(uniboxId: string): Promise<{ total: number; warmup: number; clean: number; purged: number }> {
  const msgsMap = await loadMessagesMap(uniboxId);
  let total = 0, warmup = 0, purged = 0;
  for (const accId of Object.keys(msgsMap)) {
    const kept: any[] = [];
    for (const m of msgsMap[accId]) {
      // Filtrar mensajes que ahora matchean el filtro bounce/test (test emails
      // de chequeo de cuenta de Instantly/Smartlead, mailer-daemon, etc.).
      if (isBounceOrFailure({ from: m.from, fromAddress: m.fromAddress, fromName: m.fromName, subject: m.subject, text: m.text })) {
        purged++;
        continue;
      }
      total++;
      const flag = isWarmupMessage({ subject: m.subject, text: m.text, html: m.html, from: m.from });
      if (flag) warmup++;
      kept.push({ ...m, is_warmup: flag });
    }
    msgsMap[accId] = kept;
  }
  await saveMessagesMap(uniboxId, msgsMap);
  return { total, warmup, clean: total - warmup, purged };
}
