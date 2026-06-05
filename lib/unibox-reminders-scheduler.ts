import nodemailer from "nodemailer";
import { listUniboxIds, listAccounts, loadMessagesMap } from "./unibox-store";
import { listReminders, updateReminder } from "./unibox-reminders";

declare global {
  // eslint-disable-next-line no-var
  var __uniboxRemindersScheduler: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __uniboxRemindersRunning: boolean | undefined;
}

const TICK_MS = 60_000; // cada minuto

export function startUniboxRemindersScheduler() {
  if (globalThis.__uniboxRemindersScheduler) return;
  if (process.env.EMERGENCY_MODE === "1" || process.env.EMERGENCY_MODE === "true") {
    console.warn("[unibox-reminders] EMERGENCY_MODE activo — start IGNORADO");
    return;
  }
  console.log("[unibox-reminders-scheduler] starting (60s tick)");
  const safeTick = async () => {
    if (globalThis.__uniboxRemindersRunning) return;
    globalThis.__uniboxRemindersRunning = true;
    try {
      await tick();
    } catch (e: any) {
      console.error("[unibox-reminders] tick error:", e?.message || e);
    } finally {
      globalThis.__uniboxRemindersRunning = false;
    }
  };
  globalThis.__uniboxRemindersScheduler = setInterval(safeTick, TICK_MS);
  // Primer tick a los 10s
  setTimeout(safeTick, 10_000);
}

export async function tick() {
  const uniboxIds = await listUniboxIds();
  for (const uniboxId of uniboxIds) {
    await processReminders(uniboxId);
  }
}

async function processReminders(uniboxId: string) {
  const reminders = await listReminders(uniboxId);
  if (reminders.length === 0) return;

  // Cargamos mensajes en memoria para chequear si recibimos respuesta del recipient
  const msgsMap = await loadMessagesMap(uniboxId);
  const now = Date.now();
  const accs = await listAccounts(uniboxId);

  for (const r of reminders) {
    if (r.status !== "pending") continue;

    // 1) ¿Recibió respuesta del destinatario tras crear el reminder?
    //    Si en la cuenta del remitente hay algún mensaje INBOUND de
    //    r.recipient con date > r.created_at → cancelar.
    const acctMsgs = msgsMap[r.account_id] || [];
    const createdMs = new Date(r.created_at).getTime();
    const replied = acctMsgs.find((m) => {
      // Sólo mensajes positivos (recibidos, no enviados)
      if (typeof m.uid === "number" && m.uid < 0) return false; // negative uids = sent
      const fromAddr = (m.fromAddress || m.from || "").toLowerCase();
      if (!fromAddr.includes(r.recipient)) return false;
      const dateMs = new Date(m.date).getTime();
      return dateMs > createdMs;
    });
    if (replied) {
      await updateReminder(uniboxId, r.id, {
        status: "cancelled_by_reply",
      });
      console.log(`[unibox-reminders] ${r.id}: cancelled (respuesta de ${r.recipient})`);
      continue;
    }

    // 2) ¿Llegó la hora? Si scheduled_at <= now → enviar.
    if (new Date(r.scheduled_at).getTime() > now) continue;

    const acc = accs.find((a) => a.id === r.account_id);
    if (!acc) {
      await updateReminder(uniboxId, r.id, { status: "failed", error: "Cuenta no encontrada" });
      continue;
    }

    try {
      const port = acc.smtp_port || 587;
      const secure = port === 465;
      const transporter = nodemailer.createTransport({
        host: acc.smtp_host,
        port,
        secure,
        auth: { user: acc.smtp_user || acc.email, pass: acc.smtp_pass },
        tls: { rejectUnauthorized: false },
        requireTLS: !secure && port === 587,
      });

      const displayName = [acc.first_name, acc.last_name].filter(Boolean).join(" ") || acc.email;
      const subject = /^re:\s*/i.test(r.original_subject)
        ? r.original_subject
        : `Re: ${r.original_subject}`;
      const body = r.reminder_body && r.reminder_body.trim().length > 0
        ? r.reminder_body
        : defaultReminderBody();
      const hasHtml = /<[a-z][\s\S]*>/i.test(body);
      const html = hasHtml ? body : body.replace(/\n/g, "<br>");

      const refList = [...(r.original_references || [])];
      if (r.original_message_id && !refList.includes(r.original_message_id)) {
        refList.push(r.original_message_id);
      }

      const info = await transporter.sendMail({
        from: `"${displayName}" <${acc.email}>`,
        to: r.recipient,
        subject,
        text: body.replace(/<[^>]+>/g, ""),
        html,
        inReplyTo: r.original_message_id,
        references: refList,
        headers: r.original_message_id ? {
          "In-Reply-To": r.original_message_id,
          "References": refList.join(" "),
        } : undefined,
      });
      transporter.close();

      await updateReminder(uniboxId, r.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_message_id: info.messageId,
      });
      console.log(`[unibox-reminders] ${r.id}: sent → ${r.recipient}`);

      // Forzar sync de la cuenta para que el sent reminder aparezca en la unibox
      try {
        const { syncUnibox } = await import("./unibox-sync");
        setImmediate(() => syncUnibox(uniboxId).catch(() => {}));
      } catch {}
    } catch (e: any) {
      await updateReminder(uniboxId, r.id, {
        status: "failed",
        error: e?.message || String(e),
      });
      console.error(`[unibox-reminders] ${r.id} FAILED:`, e?.message || e);
    }
  }
}

function defaultReminderBody(): string {
  return `<p>Hola,</p><p>Quería retomar el hilo por si se te pasó. ¿Cómo lo ves?</p><p>Un saludo</p>`;
}
