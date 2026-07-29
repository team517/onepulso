import { listAllScheduledFollowups, getThread, updateFollowup, appendMessage, listThreads, compactThreads } from "./email-threads";
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

// 60s entre ticks — antes 30s, pero con email-threads grande el tick
// anterior aún no acababa y se acumulaban. Tras compactThreads bajamos a 30s.
const TICK_MS = 60_000;

export function startEmailScheduler() {
  if (globalThis.__emailScheduler) return;
  // EMERGENCY_MODE: blocking guard en TODAS las funciones de arranque,
  // no solo en instrumentation.ts. Endpoints como /api/cron/tick también
  // llamaban a esta función → bypaseaban el guard de instrumentation.
  if (process.env.EMERGENCY_MODE === "1" || process.env.EMERGENCY_MODE === "true") {
    console.warn("[email-scheduler] EMERGENCY_MODE activo — start IGNORADO");
    return;
  }
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
// INTERVALOS subidos para reducir presión sobre Postgres mientras el
// blob email-threads sigue siendo grande. Tras compactThreads se puede
// volver a bajar a 30s.
const INBOX_SYNC_MS = 60_000;        // sync incremental cada 60s (antes 30s)
const DEEP_REFRESH_MS = 5 * 60_000;  // deep refresh cada 5 min (antes 2 min)
// Sync de uniboxes desde el backend cada 5 min. El cliente ya sincroniza
// cada 60s cuando tiene el unibox abierto, así que el backend solo cubre
// el caso de que NADIE esté mirando. 5 min reduce el trabajo de sync (y RAM)
// drásticamente vs cada 60s — antes había sync del cliente + del backend
// duplicando el consumo.
const UNIBOX_SYNC_MS = 5 * 60_000;

/**
 * Rescata follow-ups atascadas en "sending" durante más de N minutos.
 * Esto ocurre si el proceso murió a medio envío (OOM, deploy, crash).
 * Las devolvemos a "scheduled" para que el siguiente tick las reintente.
 */
async function rescueStuckSendingFollowups(maxStuckMinutes = 5): Promise<number> {
  const threads = await listThreads();
  const cutoff = Date.now() - maxStuckMinutes * 60_000;
  let rescued = 0;
  for (const t of threads) {
    for (const f of t.followups ?? []) {
      if (f.status === "sending") {
        // No tenemos timestamp exacto de cuándo pasó a sending; usamos updated_at del thread.
        const stamp = new Date(t.updated_at).getTime();
        if (stamp < cutoff) {
          await updateFollowup(t.id, f.id, { status: "scheduled", error: undefined });
          rescued++;
          console.log(`[email-scheduler] rescued stuck follow-up ${f.id} (thread ${t.id}) — devuelto a scheduled`);
        }
      }
    }
  }
  return rescued;
}

let lastStuckCheck = 0;
const STUCK_CHECK_MS = 5 * 60_000; // cada 5 min

let lastCompact = 0;
const COMPACT_MS = 6 * 60 * 60_000; // cada 6h: archiva hilos viejos/cerrados

let lastReportsCheck = 0;
const REPORTS_CHECK_MS = 30 * 60_000; // cada 30 min: informes de clientes vencidos

export async function tick() {
  // EMERGENCY_MODE bypass — no hacer trabajo de fondo si está activo.
  if (process.env.EMERGENCY_MODE === "1" || process.env.EMERGENCY_MODE === "true") {
    return { skipped: true, reason: "EMERGENCY_MODE" } as any;
  }
  // 0. Cada 5 min, rescatar followups "sending" atascadas
  if (Date.now() - lastStuckCheck > STUCK_CHECK_MS) {
    lastStuckCheck = Date.now();
    try {
      const n = await rescueStuckSendingFollowups();
      if (n > 0) console.log(`[email-scheduler] ${n} follow-ups rescatadas de sending → scheduled`);
    } catch (e: any) {
      console.error("[email-scheduler] stuck check error:", e.message);
    }
  }

  // 0.b Cada 6h, compactar el blob email-threads: archiva hilos inactivos
  // (cerrados/obsoletos > 30 días y sin follow-up pendiente) a una clave
  // aparte. Mantiene el blob principal pequeño → /seguimientos carga rápido
  // y el tick lee menos MB.
  if (Date.now() - lastCompact > COMPACT_MS) {
    lastCompact = Date.now();
    try {
      const c = await compactThreads({ olderThanDays: 30 });
      if (c.archivedNow > 0) {
        console.log(`[email-scheduler] compactado: ${c.archivedNow} hilos archivados (activos=${c.keptActive})`);
      }
    } catch (e: any) {
      console.error("[email-scheduler] compact error:", e.message);
    }
  }

  // 0.c Cada 30 min: enviar informes de clientes (Smartlead) cuyo intervalo
  // (p.ej. 48h) haya vencido. Cada config decide si está activo.
  if (Date.now() - lastReportsCheck > REPORTS_CHECK_MS) {
    lastReportsCheck = Date.now();
    try {
      const { runDueReports } = await import("./client-reports");
      const r = await runDueReports();
      if (r.sent > 0 || r.errors > 0) console.log(`[email-scheduler] informes clientes: ${r.sent} enviados, ${r.errors} errores`);
    } catch (e: any) {
      console.error("[email-scheduler] client reports error:", e.message);
    }
  }

  // 0.d Alerta DIARIA de interesados a las 18:00 (Europe/Madrid), escalonada por
  // cliente. La función se auto-limita a la franja 18:00–21:59 y a un chequeo/día,
  // así que llamarla cada tick es barato (fuera de esa franja retorna al instante).
  try {
    const { runDailyInterestedAlerts } = await import("./client-reports");
    const a = await runDailyInterestedAlerts();
    if (a.sent > 0 || a.errors > 0) console.log(`[email-scheduler] alertas interesados: ${a.sent} enviadas, ${a.errors} errores (${a.checked} revisados)`);
  } catch (e: any) {
    console.error("[email-scheduler] daily interested alerts error:", e.message);
  }

  // 1. Enviar follow-ups vencidos
  const dueResults = await sendDueFollowups();

  // 2 y 3 DESACTIVADOS: syncInbox y deepRefreshAllThreads procesaban
  // cientos de UIDs en paralelo agotando el pool de Postgres ("Connection
  // not available"). Esto rompía el unibox para el usuario. Si necesitas
  // sync de /seguimientos, dispáralo manual desde /api/email/sync-thread.
  // El UNIBOX tiene su propio sync IMAP (no afectado).

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

    // ATOMIC CLAIM: re-leer el thread y verificar que la followup sigue "scheduled".
    // Si otro proceso (cron manual, retry desde UI, otro tick) ya la cogió, saltamos.
    const freshThread = await getThread(f.thread_id);
    const freshFu = freshThread?.followups.find((x) => x.id === f.id);
    if (!freshFu || freshFu.status !== "scheduled") {
      console.log(`[email-scheduler] skip ${f.id}: status ya es ${freshFu?.status ?? "(borrada)"}`);
      continue;
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
