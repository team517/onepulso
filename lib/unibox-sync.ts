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
      // Traer hasta los últimos 200 mensajes (antes 50). Cubre cuentas con
      // tráfico alto. Como deduplicamos por UID, los ya vistos no se reprocesan.
      const start = Math.max(1, total - 199);
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
          const fromName = (msg.envelope as any)?.from?.[0]?.name || "";
          const fromAddress = (msg.envelope as any)?.from?.[0]?.address || "";
          const warmup = isWarmupMessage({ subject, text, html, from: fromAddr });

          // FILTRO BOUNCE: si es un mensaje de delivery failure / mailer-daemon
          // / "user unknown", lo descartamos para que no llene la bandeja.
          if (isBounceOrFailure({ from: fromAddr, fromAddress, fromName, subject, text })) {
            continue;
          }

          // Normalizamos message-ids: SIEMPRE con <> para que los servidores
          // SMTP los reconozcan como referencias válidas al responder.
          const wrap = (s: string): string => {
            const t = String(s || "").trim();
            if (!t) return "";
            const cleaned = t.replace(/^<+|>+$/g, "");
            return cleaned ? `<${cleaned}>` : "";
          };
          // messageId: parsed prioritario, fallback al envelope (más fiable IMAP)
          const messageId = wrap(parsed.messageId || (msg.envelope as any)?.messageId || "");
          const inReplyTo = wrap((parsed.inReplyTo as string) || (msg.envelope as any)?.inReplyTo || "");
          const refsRaw = parsed.references;
          const refsArr = Array.isArray(refsRaw) ? refsRaw : refsRaw ? [refsRaw] : [];
          const references = refsArr.map(wrap).filter(Boolean);

          fresh.push({
            uid: msg.uid,
            messageId,
            inReplyTo,
            references,
            from: fromAddr,
            fromName,
            fromAddress,
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

      // Mantener cache de 400 mensajes (más histórico visible)
      msgsMap[accountId] = [...fresh, ...existing].slice(0, 400);
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

/** Sincroniza también la carpeta Sent (envíos del propio usuario) — opcional, no falla si no existe. */
async function syncAccountSent(uniboxId: string, accountId: string): Promise<number> {
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

      const status = await client.status(sentFolder.path, { messages: true });
      const total = status.messages || 0;
      if (total === 0) { await client.logout(); return 0; }
      const start = Math.max(1, total - 19); // últimos 20 enviados
      const range = `${start}:*`;

      const fresh: UniboxMessage[] = [];
      for await (const msg of client.fetch(range, { envelope: true, source: true, uid: true, flags: true })) {
        // Para Sent usamos UID con prefijo 's' para no colisionar con INBOX UIDs
        const uidPseudo = -1 * msg.uid; // negative UIDs identifican Sent
        const uidStr = String(uidPseudo);
        if (existingUids.has(uidStr)) continue;
        try {
          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          const subject = parsed.subject || "(sin asunto)";
          const text = parsed.text || "";
          const html = (parsed.html as string) || "";
          const fromAddr = parsed.from?.text || (msg.envelope as any)?.from?.[0]?.address || "";
          const fromName = (msg.envelope as any)?.from?.[0]?.name || "";
          const fromAddress = (msg.envelope as any)?.from?.[0]?.address || "";
          if (isBounceOrFailure({ from: fromAddr, fromAddress, fromName, subject, text })) continue;
          const warmup = isWarmupMessage({ subject, text, html, from: fromAddr });
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
          fresh.push({
            uid: uidPseudo,
            messageId,
            inReplyTo,
            references,
            from: fromAddr,
            fromName,
            fromAddress,
            to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map(t => t.text).join(", ") : parsed.to.text) : "",
            toAddress: (msg.envelope as any)?.to?.[0]?.address || "",
            subject,
            date: (parsed.date || (msg.envelope as any)?.date || new Date()).toISOString(),
            preview: text.replace(/\s+/g, " ").trim().slice(0, 180),
            text,
            html,
            unread: false, // los enviados nunca son "no leídos"
            is_warmup: warmup,
            attachments: (parsed.attachments || []).map((a: any) => ({ filename: a.filename || "", contentType: a.contentType || "", size: a.size || 0 })),
          } as any);
          (fresh[fresh.length - 1] as any).is_sent = true;
          newCount++;
        } catch {}
      }
      msgsMap[accountId] = [...fresh, ...existing].slice(0, 250);
      await saveMessagesMap(uniboxId, msgsMap);
    } finally { lock.release(); }
    await client.logout();
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
        const inboxNew = await syncAccount(uniboxId, a.id);
        let sentNew = 0;
        try { sentNew = await syncAccountSent(uniboxId, a.id); } catch {}
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
