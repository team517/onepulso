/**
 * Reminders / Follow-ups del Unibox.
 *
 * Cuando un cliente envía un email desde el Unibox, puede marcar "Programar
 * recordatorio si no responde". Eso crea un Reminder en estado "pending".
 *
 * Un scheduler revisa cada minuto:
 *  - Reminders con scheduled_at <= now y status="pending" → envía el reminder
 *    (un mensaje de seguimiento al mismo hilo).
 *  - Reminders cuyo hilo recibió respuesta del destinatario → cancela
 *    automáticamente con status="cancelled_by_reply".
 *
 * Storage: key "unibox-reminders/{uniboxId}" → array.
 */
import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";

export type Reminder = {
  id: string;
  unibox_id: string;
  account_id: string;
  /** Email del destinatario al que recordamos. */
  recipient: string;
  /** Subject original (sin Re:). El reminder se envía como Re: ... */
  original_subject: string;
  /** Message-Id del primer mensaje enviado por nosotros (con <...>). */
  original_message_id: string;
  /** Cadena de References del mensaje original. */
  original_references: string[];
  /** Texto del reminder. Si está vacío, usamos el body por defecto. */
  reminder_body: string;
  /** Cuándo programado para enviarse. */
  scheduled_at: string;
  /** Cuándo se creó el reminder. */
  created_at: string;
  status: "pending" | "sent" | "cancelled_by_reply" | "cancelled" | "failed";
  /** Si se envió, message-id del reminder enviado. */
  sent_message_id?: string;
  sent_at?: string;
  error?: string;
};

const KEY = (uniboxId: string) => `unibox-reminders/${uniboxId}`;

export async function listReminders(uniboxId: string): Promise<Reminder[]> {
  return (await readJson<Reminder[]>(KEY(uniboxId))) || [];
}

async function saveReminders(uniboxId: string, list: Reminder[]) {
  await writeJson(KEY(uniboxId), list);
}

export async function createReminder(input: {
  unibox_id: string;
  account_id: string;
  recipient: string;
  original_subject: string;
  original_message_id: string;
  original_references?: string[];
  reminder_body?: string;
  delay_hours: number;
}): Promise<Reminder> {
  const list = await listReminders(input.unibox_id);
  const now = Date.now();
  const reminder: Reminder = {
    id: randomUUID(),
    unibox_id: input.unibox_id,
    account_id: input.account_id,
    recipient: input.recipient.toLowerCase().trim(),
    original_subject: input.original_subject,
    original_message_id: input.original_message_id,
    original_references: input.original_references ?? [],
    reminder_body: input.reminder_body?.trim() || "",
    scheduled_at: new Date(now + input.delay_hours * 60 * 60 * 1000).toISOString(),
    created_at: new Date(now).toISOString(),
    status: "pending",
  };
  list.push(reminder);
  await saveReminders(input.unibox_id, list);
  return reminder;
}

export async function updateReminder(
  uniboxId: string,
  reminderId: string,
  patch: Partial<Reminder>,
): Promise<Reminder | null> {
  const list = await listReminders(uniboxId);
  const idx = list.findIndex((r) => r.id === reminderId);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, id: list[idx].id };
  await saveReminders(uniboxId, list);
  return list[idx];
}

export async function deleteReminder(uniboxId: string, reminderId: string): Promise<void> {
  const list = await listReminders(uniboxId);
  const next = list.filter((r) => r.id !== reminderId);
  await saveReminders(uniboxId, next);
}

/** Reminders pendientes asociados a una cuenta + destinatario (para visualización en UI). */
export async function findPendingReminderFor(
  uniboxId: string,
  accountId: string,
  recipient: string,
): Promise<Reminder | null> {
  const list = await listReminders(uniboxId);
  const target = recipient.toLowerCase().trim();
  return (
    list.find(
      (r) =>
        r.status === "pending" &&
        r.account_id === accountId &&
        r.recipient === target,
    ) || null
  );
}
