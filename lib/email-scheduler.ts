import { listAllScheduledFollowups, getThread, updateFollowup, appendMessage } from "./email-threads";
import { sendEmail } from "./email-send";
import { readEmailConfig } from "./email-config";
import { syncInbox } from "./email-inbox";
import { isSendIfNoReply, stripConditionMarkers } from "./email-sequences";
import { runAutopilot } from "./email-autopilot";

declare global {
  // eslint-disable-next-line no-var
  var __emailScheduler: NodeJS.Timeout | undefined;
}

const TICK_MS = 60_000; // 60s

export function startEmailScheduler() {
  if (globalThis.__emailScheduler) return;
  console.log("[email-scheduler] starting (60s tick: followups + inbox sync)");
  globalThis.__emailScheduler = setInterval(tick, TICK_MS);
  tick().catch((e) => console.error("[email-scheduler] initial error", e));
}

let lastInboxSync = 0;
const INBOX_SYNC_MS = 5 * 60_000; // sync inbox cada 5 min

export async function tick() {
  // 1. Enviar follow-ups vencidos
  const dueResults = await sendDueFollowups();

  // 2. Sync inbox cada 5 min
  if (Date.now() - lastInboxSync > INBOX_SYNC_MS) {
    lastInboxSync = Date.now();
    try {
      const r = await syncInbox({ days: 3, max: 30 });
      if (r.new_messages > 0) {
        console.log(`[email-scheduler] inbox sync: ${r.new_messages} new in ${r.threads_touched.length} threads`);
        // Después de sync, correr autopilot por si hay nuevas inbounds
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
      const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
      const lastOutbound = [...thread.messages].reverse().find((m) => m.direction === "outbound");
      const refMsg = lastInbound || lastOutbound;
      const recipient =
        thread.participants.find((p) => p.toLowerCase() !== cfg.email.toLowerCase()) ??
        thread.participants[0];

      const subject = thread.subject.startsWith("Re:") ? thread.subject : `Re: ${thread.subject}`;
      const cleanBody = stripConditionMarkers(f.body_html);
      const info = await sendEmail({
        to: recipient,
        subject,
        body_html: cleanBody,
        in_reply_to: refMsg?.message_id,
        references: refMsg ? [...(refMsg.references ?? []), refMsg.message_id ?? ""].filter(Boolean) : undefined,
      });
      await appendMessage(f.thread_id, {
        direction: "outbound",
        from: cfg.email,
        to: [recipient],
        subject,
        body_html: cleanBody,
        message_id: info.messageId,
        in_reply_to: refMsg?.message_id,
        references: refMsg ? [...(refMsg.references ?? []), refMsg.message_id ?? ""].filter(Boolean) : undefined,
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
