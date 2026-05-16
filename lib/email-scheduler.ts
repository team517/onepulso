import { listAllScheduledFollowups, getThread, updateFollowup, appendMessage } from "./email-threads";
import { sendEmail } from "./email-send";
import { readEmailConfig } from "./email-config";
import { syncInbox, deepRefreshAllThreads } from "./email-inbox";
import { isSendIfNoReply, stripConditionMarkers } from "./email-sequences";
import { runAutopilot } from "./email-autopilot";
import { processTaskReminders } from "./tasks-reminder";
import { syncAllUniboxes } from "./unibox-sync";

declare global {
  // eslint-disable-next-line no-var
  var __emailScheduler: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __emailSchedulerRunning: boolean | undefined;
}

const TICK_MS = 30_000; // 30s — más reactivo

export function startEmailScheduler() {
  if (globalThis.__emailScheduler) return;
  console.log("[email-scheduler] starting (30s tick: followups + inbox sync)");

  // Wrapper que evita reentrancia: si un tick tarda más de 30s, el siguiente
  // se salta en vez de ejecutarse en paralelo (causa común de OOM).
  const safeTick = async () => {
    if (globalThis.__emailSchedulerRunning) {
      console.log("[email-scheduler] tick anterior aún corre — saltando");
      return;
    }
    globalThis.__emailSchedulerRunning = true;
    try {
      await tick();
    } catch (e: any) {
      console.error("[email-scheduler] tick error:", e?.message || e);
    } finally {
      globalThis.__emailSchedulerRunning = false;
    }
  };

  globalThis.__emailScheduler = setInterval(safeTick, TICK_MS);
  safeTick();

  // Capturar errores no capturados para que el proceso no muera por un fallo de async
  if (!(globalThis as any).__emailSchedulerHandlersInstalled) {
    process.on("unhandledRejection", (reason: any) => {
      console.error("[unhandledRejection]", reason?.message || reason);
    });
    process.on("uncaughtException", (err: any) => {
      console.error("[uncaughtException]", err?.message || err);
    });
    (globalThis as any).__emailSchedulerHandlersInstalled = true;
  }
}

let lastInboxSync = 0;
let lastDeepRefresh = 0;
let lastUniboxSync = 0;
const INBOX_SYNC_MS = 30_000;      // sync incremental cada 30s
const DEEP_REFRESH_MS = 2 * 60_000; // deep refresh cada 2 minutos
const UNIBOX_SYNC_MS = 90_000;      // sync de uniboxes cada 90 segundos

export async function tick() {
  // 1. Enviar follow-ups vencidos
  const dueResults = await sendDueFollowups();

  // 2. Sync incremental (rápido, cada 30s)
  if (Date.now() - lastInboxSync > INBOX_SYNC_MS) {
    lastInboxSync = Date.now();
    try {
      const r = await syncInbox({ days: 14, max: 150 });
      if (r.new_messages > 0) {
        console.log(`[email-scheduler] inbox sync: ${r.new_messages} new in ${r.threads_touched.length} threads`);
        try {
          const ap = await runAutopilot();
          if (ap.scheduled > 0) {
            console.log(`[email-scheduler] autopilot: ${ap.processed} procesados, ${ap.scheduled} agendados, ${ap.errors} errores`);
          }
        } catch (e) {
          console.error("[email-scheduler] autopilot error", e);
        }
      }
    } catch (e) {
      console.error("[email-scheduler] inbox sync error", e);
    }
  }

  // 3. DEEP REFRESH (cada 2 min): para CADA hilo abierto, escanea Gmail
  //    buscando todos los mensajes intercambiados con cada participante en
  //    los últimos 60 días, en todas las carpetas. Garantiza que cualquier
  //    respuesta (en cualquier dirección) acabe en la plataforma aunque
  //    se haya perdido en el sync incremental por threading roto, etc.
  if (Date.now() - lastDeepRefresh > DEEP_REFRESH_MS) {
    lastDeepRefresh = Date.now();
    try {
      const r = await deepRefreshAllThreads({ days: 60, maxThreads: 100 });
      if (r.new_messages > 0) {
        console.log(`[email-scheduler] deep refresh: ${r.new_messages} mensajes nuevos en ${r.threads_refreshed} hilos`);
        // Si encontramos algo, dispara autopilot por si toca responder
        try { await runAutopilot(); } catch (e) {}
      }
    } catch (e: any) {
      console.error("[email-scheduler] deep refresh error", e.message);
    }
  }

  // 4. Recordatorios de tareas (cada tick — fn interna decide qué notificar)
  try {
    const tr = await processTaskReminders();
    if (tr.sent > 0) {
      console.log(`[email-scheduler] task reminders: ${tr.sent} enviados (${tr.checked} revisadas)`);
    }
  } catch (e: any) {
    console.error("[email-scheduler] task reminders error", e.message);
  }

  // 5. Sync de todas las uniboxes cada 3 min (IMAP de las cuentas conectadas)
  if (Date.now() - lastUniboxSync > UNIBOX_SYNC_MS) {
    lastUniboxSync = Date.now();
    try {
      const r = await syncAllUniboxes();
      if (r.total_new > 0) {
        console.log(`[email-scheduler] uniboxes: ${r.total_new} mensajes nuevos en ${r.uniboxes} uniboxes`);
      }
      if (r.errors > 0) {
        console.warn(`[email-scheduler] uniboxes: ${r.errors} uniboxes con error`);
      }
    } catch (e: any) {
      console.error("[email-scheduler] unibox sync error", e.message);
    }
  }

  return dueResults;
}

export async function sendDueFollowups(): Promise<{ sent: number; failed: number }> {
  const items = await listAllScheduledFollowups();
  const now = Date.now();
  let sent = 0;
  let failed = 0;
  for (const f of items) {
    if (new Date(f.scheduled_at).getTime() > now) continue;

    // Lógica condicional: si lleva el marcador send_if_no_reply Y el prospect ha respondido
    // después de la fecha de creación del follow-up → cancelar (no enviar).
    const conditional = isSendIfNoReply(f.body_html);
    if (conditional) {
      const t = await getThread(f.thread_id);
      if (t) {
        const lastInboundDate = t.last_inbound_at ? new Date(t.last_inbound_at).getTime() : 0;
        // Si hay un inbound más reciente que la programación → cancelar
        const followupCreatedRoughly = new Date(f.scheduled_at).getTime() - 1; // proxy
        if (lastInboundDate > 0 && lastInboundDate >= followupCreatedRoughly - 30 * 24 * 60 * 60 * 1000) {
          // Si recibió cualquier inbound entre la creación de este FU y "ahora" → cancelar
          // Más seguro: comprobamos si el último mensaje del thread es inbound (= han respondido)
          const lastMsg = t.messages[t.messages.length - 1];
          if (lastMsg?.direction === "inbound") {
            await updateFollowup(f.thread_id, f.id, { status: "cancelled", error: "auto-skip: el prospect respondió" });
            console.log(`[email-scheduler] skip ${f.id}: prospect replied`);
            continue;
          }
        }
      }
    }

    await updateFollowup(f.thread_id, f.id, { status: "sending" });
    try {
      const cfg = await readEmailConfig();
      if (!cfg) throw new Error("Email no conectado");
      const thread = await getThread(f.thread_id);
      if (!thread) throw new Error("Thread no encontrado");
      // Reply al ÚLTIMO mensaje del hilo (cualquier dirección)
      const lastMsg = thread.messages[thread.messages.length - 1];
      const refMsg = lastMsg;
      const recipient =
        thread.participants.find((p) => p.toLowerCase() !== cfg.email.toLowerCase()) ??
        thread.participants[0];

      const baseSubject = thread.subject.replace(/^(re:\s*)+/i, "").trim();
      const subject = `Re: ${baseSubject}`;
      const cleanBody = stripConditionMarkers(f.body_html);

      // Cadena de References completa
      const refsChain: string[] = [];
      if (refMsg?.references) refsChain.push(...refMsg.references);
      if (refMsg?.in_reply_to && !refsChain.includes(refMsg.in_reply_to)) {
        refsChain.push(refMsg.in_reply_to);
      }
      if (refMsg?.message_id && !refsChain.includes(refMsg.message_id)) {
        refsChain.push(refMsg.message_id);
      }

      const info = await sendEmail({
        to: recipient,
        subject,
        body_html: cleanBody,
        in_reply_to: refMsg?.message_id,
        references: refsChain.length > 0 ? refsChain : undefined,
      });
      await appendMessage(f.thread_id, {
        direction: "outbound",
        from: cfg.email,
        to: [recipient],
        subject,
        body_html: cleanBody,
        message_id: info.messageId,
        in_reply_to: refMsg?.message_id,
        references: refsChain.length > 0 ? refsChain : undefined,
        date: new Date().toISOString(),
      });
      await updateFollowup(f.thread_id, f.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_message_id: info.messageId,
      });
      sent++;
    } catch (e: any) {
      await updateFollowup(f.thread_id, f.id, { status: "failed", error: e.message });
      failed++;
    }
  }
  return { sent, failed };
}
