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
import { upsertMessages, ensureMigrated } from "./unibox-messages-db";
import { isWarmupMessage, isNonIberianMessage } from "./unibox-warmup";

/** ¿Este unibox permite mensajes en cualquier idioma? Solo tcx (negocio
 *  internacional). Los demás solo aceptan español/catalán en la bandeja.
 *  Cacheado por uniboxId para no consultar en cada cuenta. */
const _langCache = new Map<string, { allow: boolean; ts: number }>();
async function uniboxAllowsAllLanguages(uniboxId: string): Promise<boolean> {
  const cached = _langCache.get(uniboxId);
  if (cached && Date.now() - cached.ts < 5 * 60_000) return cached.allow;
  let allow = false;
  try {
    const { getUnibox } = await import("./unibox-store");
    const u = await getUnibox(uniboxId);
    const title = (u?.title || "").toLowerCase();
    // tcx (cualquier variante: "tcx", "tcx micro", etc.) permite todo idioma.
    allow = title.includes("tcx");
  } catch {}
  _langCache.set(uniboxId, { allow, ts: Date.now() });
  return allow;
}

// Máximo de mensajes guardados por cuenta en el cache. 1500 recientes
// cubre de sobra para ver respuestas (los warmup viejos son ruido).
// Antes 50000 → con 40 cuentas eran 2M mensajes potenciales en RAM.
// Con 1500 → 40 cuentas = 60k mensajes = blob manejable (~50MB en RAM).
const MAX_MSGS_PER_ACCOUNT = 1500;

// ─────────────────────────────────────────────────────────────────────────────
// LOCK PER-UNIBOX para escrituras del mapa de mensajes.
//
// BUG QUE ARREGLA: cuando 15 cuentas sincronizan en paralelo, todas hacen
//   1. loadMessagesMap()  → obtienen el MISMO estado
//   2. modifican msgsMap[accountId]
//   3. saveMessagesMap()  → la última gana, las demás SE PIERDEN
//
// Resultado: 15 cuentas sincronizan pero solo se guardan los mensajes de
// la última. Las otras 14 desaparecen → "no salen mensajes".
//
// Solución: serializar el read-modify-write con un lock por unibox.
// Cada syncAccount entra en su turno, lee el estado fresco, hace su merge
// y guarda. La descarga IMAP (lo lento) sigue 100% paralela.
// ─────────────────────────────────────────────────────────────────────────────
const uniboxLocks = new Map<string, Promise<void>>();
async function withUniboxLock<T>(uniboxId: string, fn: () => Promise<T>): Promise<T> {
  const prev = uniboxLocks.get(uniboxId) || Promise.resolve();
  let release!: () => void;
  const lock = new Promise<void>((resolve) => { release = resolve; });
  uniboxLocks.set(uniboxId, prev.then(() => lock));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // Si nadie más está esperando, limpiamos el lock
    if (uniboxLocks.get(uniboxId) === prev.then(() => lock)) {
      // (en la práctica esto rara vez se cumple, no es crítico)
    }
  }
}

/** Sincroniza una cuenta IMAP — descarga últimos 50 mensajes, los mergea en caché. */
export async function syncAccount(uniboxId: string, accountId: string): Promise<number> {
  // Migrar el histórico del bloque viejo a la tabla ANTES de insertar nuevos
  // (si no, la tabla tendría solo lo nuevo y se perdería el histórico).
  await ensureMigrated(uniboxId);
  const accs = await listAccounts(uniboxId);
  const idx = accs.findIndex((a) => a.id === accountId);
  if (idx === -1) return 0;
  const account = accs[idx];

  // FILTRO DE IDIOMA: en todos los uniboxes EXCEPTO tcx, los mensajes que
  // no son español/catalán (inglés, warmup de outreach, etc.) se marcan
  // como warmup y se ocultan. tcx permite cualquier idioma (internacional).
  const allowAllLanguages = await uniboxAllowsAllLanguages(uniboxId);

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
      // El objetivo de cache es min(total, MAX_MSGS_PER_ACCOUNT). El cache
      // está "completo" si tiene el 80% de ese objetivo. Así una cuenta con
      // 5000 mensajes pero cap 1500 NO re-sincroniza eternamente.
      const targetCount = Math.min(total, MAX_MSGS_PER_ACCOUNT);
      const cacheCompleteEnough = cachedCount >= targetCount * 0.8;
      let range: string;
      let isIncremental = false;
      if (lastUid > 0 && cacheCompleteEnough) {
        // Cache OK + UID guardado → incremental rápido
        range = `${lastUid + 1}:*`;
        isIncremental = true;
      } else {
        // Cache vacío/incompleto → descarga los últimos MAX_MSGS_PER_ACCOUNT
        // (no TODO el histórico — ahorra RAM y ancho de banda).
        if (lastUid > 0 && !cacheCompleteEnough) {
          console.log(`[unibox-sync] ${account.email}: cache=${cachedCount}/${targetCount} → full sync (últimos ${MAX_MSGS_PER_ACCOUNT})`);
        }
        const start = Math.max(1, total - (MAX_MSGS_PER_ACCOUNT - 1));
        range = `${start}:*`;
      }

      console.log(`[unibox-sync] ${account.email}: ${isIncremental ? `incremental UID > ${lastUid}` : `inicial seq ${range}`} (UIDNEXT=${status.uidNext}, total=${total})`);

      const fresh: UniboxMessage[] = [];
      let fetched = 0;
      let skippedDupe = 0;
      let skippedFilter = 0;
      let parseErrors = 0;
      // FAST MODE: solo envelope, sin source. El cuerpo se descarga
      // bajo demanda cuando el usuario abre el mensaje (10x más rápido).
      // Resultado: por cuenta ~3s en vez de ~30s.
      const fetcher = isIncremental
        ? client.fetch(range, { envelope: true, uid: true, flags: true }, { uid: true })
        : client.fetch(range, { envelope: true, uid: true, flags: true });
      for await (const msg of fetcher) {
        fetched++;
        const uidStr = String(msg.uid);

        if (existingUids.has(uidStr)) {
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

        const subject = envSubject;
        const text = ""; // se carga bajo demanda al abrir
        const html = ""; // se carga bajo demanda al abrir
        const fromAddr = envFromAddr;
        const fromName = envFromName;
        const fromAddress = envFromAddr;
        // Warmup: por código en subject O (si no es tcx) por idioma no ibérico.
        let warmup = isWarmupMessage({ subject, text, html, from: fromAddr });
        if (!warmup && !allowAllLanguages && isNonIberianMessage({ subject, text, html })) {
          warmup = true;
        }

        // FILTRO BOUNCE — usa solo subject+from (suficiente para detectar)
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
        const messageId = wrap(envMessageId);
        const inReplyTo = wrap(envInReplyTo);
        const references: string[] = []; // se descargan con el cuerpo si hace falta

        fresh.push({
          uid: msg.uid,
          messageId,
          inReplyTo,
          references,
          from: fromAddr,
          fromName,
          fromAddress,
          to: envToAddr,
          toAddress: envToAddr,
          subject,
          date: envDate,
          preview: subject.slice(0, 180), // preview = subject hasta que se abra
          text,
          html,
          unread: !(msg.flags && msg.flags.has("\\Seen")),
          is_warmup: warmup,
          attachments: [],
        });
        // SOLO avanzar maxUidSeen tras añadir el mensaje al cache.
        if (msg.uid && msg.uid > maxUidSeen) maxUidSeen = msg.uid;
        newCount++;
      }
      console.log(`[unibox-sync] ${account.email}: fetched=${fetched} new=${newCount} dupe=${skippedDupe} filtered=${skippedFilter} parseErr=${parseErrors}`);

      // Insert/Update de filas individuales (atómico por fila vía ON CONFLICT).
      // Ya NO cargamos ni reescribimos un bloque gigante: cada mensaje es una
      // fila. Sin candado, sin race, sin pico de RAM. Solo escribe si hay nuevos.
      if (fresh.length > 0) {
        await upsertMessages(uniboxId, accountId, fresh as any);
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
  await ensureMigrated(uniboxId);
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
      const targetSentCount = Math.min(total, MAX_MSGS_PER_ACCOUNT);
      const sentCacheCompleteEnough = cachedSentCount >= targetSentCount * 0.8;
      let range: string;
      let isIncrementalSent = false;
      if (lastSentUid > 0 && sentCacheCompleteEnough) {
        range = `${lastSentUid + 1}:*`;
        isIncrementalSent = true;
      } else {
        if (lastSentUid > 0 && !sentCacheCompleteEnough) {
          console.log(`[unibox-sync sent] ${account.email}: cache=${cachedSentCount}/${targetSentCount} → full sync`);
        }
        const start = Math.max(1, total - (MAX_MSGS_PER_ACCOUNT - 1));
        range = `${start}:*`;
      }

      const fresh: UniboxMessage[] = [];
      const fetcher = isIncrementalSent
        ? client.fetch(range, { envelope: true, uid: true, flags: true }, { uid: true })
        : client.fetch(range, { envelope: true, uid: true, flags: true });
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

        // FAST MODE: solo envelope, sin source (10x más rápido).
        const subject = envSubject;
        const fromAddr = envFromAddr;
        const fromName = envFromName;
        const fromAddress = envFromAddr;
        if (isBounceOrFailure({ from: fromAddr, fromAddress, fromName, subject, text: "" })) {
          if (msg.uid && msg.uid > maxUidSentSeen) maxUidSentSeen = msg.uid;
          continue;
        }
        const warmup = isWarmupMessage({ subject, text: "", html: "", from: fromAddr });
        const wrap = (s: string): string => {
          const t = String(s || "").trim();
          if (!t) return "";
          const cleaned = t.replace(/^<+|>+$/g, "");
          return cleaned ? `<${cleaned}>` : "";
        };
        const messageId = wrap(envMessageId);
        const inReplyTo = wrap(envInReplyTo);
        fresh.push({
          uid: uidPseudo,
          messageId,
          inReplyTo,
          references: [],
          from: fromAddr,
          fromName,
          fromAddress,
          to: envToAddr,
          toAddress: envToAddr,
          subject,
          date: envDate,
          preview: subject.slice(0, 180),
          text: "",
          html: "",
          unread: false,
          is_warmup: warmup,
          attachments: [],
        } as any);
        (fresh[fresh.length - 1] as any).is_sent = true;
        if (msg.uid && msg.uid > maxUidSentSeen) maxUidSentSeen = msg.uid;
        newCount++;
      }
      // Upsert de filas individuales (igual que INBOX). Los enviados llevan
      // is_sent=true y uid negativo.
      if (fresh.length > 0) {
        await upsertMessages(uniboxId, accountId, fresh as any);
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

  // 6 cuentas en paralelo (antes 30). CADA cuenta concurrente recarga el
  // mapa de mensajes en RAM dentro del lock → 30 simultáneas = 30 copias
  // del blob = pico de RAM enorme. Con 6 el sync sigue rápido pero la RAM
  // se mantiene baja. Es el cambio más importante para no crashear.
  const CONCURRENCY = 6;
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

  // NOTA: ya NO reclasificamos toda la caché tras cada sync. Cada mensaje
  // nuevo se clasifica (is_warmup/bounce) al insertarlo en el bucle de
  // syncAccount, así que recargar el blob entero para re-clasificar era
  // trabajo redundante que disparaba la RAM. La reclasificación completa
  // sigue disponible bajo demanda en el botón "Reclasificar" del admin.

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

  // SECUENCIAL (1 unibox a la vez). Antes 3 en paralelo × 6 cuentas = 18
  // cargas simultáneas del blob de mensajes = pico de RAM. El sync de fondo
  // no tiene prisa, así que procesamos uniboxes de una en una.
  for (const u of all) {
    try {
      const r = await syncUnibox(u.id);
      totalNew += r.new;
    } catch {
      errors++;
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
  const allowAllLanguages = await uniboxAllowsAllLanguages(uniboxId);
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
      let flag = isWarmupMessage({ subject: m.subject, text: m.text, html: m.html, from: m.from });
      // Filtro de idioma: en uniboxes != tcx, los mensajes recibidos que no son
      // español/catalán se marcan warmup. Los enviados (is_sent) se respetan.
      if (!flag && !allowAllLanguages && !(m as any).is_sent && isNonIberianMessage({ subject: m.subject, text: m.text, html: m.html })) {
        flag = true;
      }
      if (flag) warmup++;
      kept.push({ ...m, is_warmup: flag });
    }
    msgsMap[accId] = kept;
  }
  await saveMessagesMap(uniboxId, msgsMap);
  return { total, warmup, clean: total - warmup, purged };
}
