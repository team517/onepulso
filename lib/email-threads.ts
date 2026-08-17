import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "email-threads";

export type EmailMessage = {
  id: string;
  direction: "outbound" | "inbound";
  from: string;
  to: string[];
  subject: string;
  body_html?: string;
  body_text?: string;
  message_id?: string;
  in_reply_to?: string;
  references?: string[];
  attachments?: Array<{ filename: string; path?: string; size?: number }>;
  date: string;
};

export type Thread = {
  id: string;
  subject: string;
  participants: string[];
  messages: EmailMessage[];
  last_inbound_at?: string;
  last_outbound_at?: string;
  status: "active" | "closed" | "stale";
  followups: Followup[];
  notes?: string;
  watched?: boolean;
  contact_name?: string;
  contact_context?: string;
  tone?: string;
  objective?: string;
  custom_prompt?: string;
  contract_alert?: {
    detected_at: string;
    message_id?: string;
    excerpt: string;
    acknowledged?: boolean;
  };
  auto_pilot?: boolean;
  auto_pilot_processed_msg_ids?: string[];
  created_at: string;
  updated_at: string;
};

export type Followup = {
  id: string;
  thread_id: string;
  body_html: string;
  scheduled_at: string;
  status: "scheduled" | "sending" | "sent" | "failed" | "cancelled" | "pending_approval";
  origin: "manual" | "ai_auto" | "ai_assisted";
  error?: string;
  sent_at?: string;
  sent_message_id?: string;
  // Razón de cancelación, útil para entender qué pasó:
  // "prospect_replied" | "manual" | "duplicate" | "thread_closed"
  cancelled_reason?: string;
  cancelled_at?: string;
};

async function readThreads(): Promise<Thread[]> {
  return (await readJson<Thread[]>(KEY)) ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ÍNDICE LIGERO de threads para la LISTA de /seguimientos.
//
// El blob `email-threads` pesa MB porque guarda el HTML de TODOS los mensajes.
// La lista solo necesita asunto, participantes, último mensaje y contadores.
// Mantenemos un índice SIN los cuerpos de mensaje → se lee al instante y cabe
// en caché. Se reconstruye en cada writeThreads (el único punto de escritura).
// ─────────────────────────────────────────────────────────────────────────────
const INDEX_KEY = "email-threads/list-index";

/** Thread sin el array pesado de `messages`: solo resumen del último mensaje. */
export type ThreadLight = Omit<Thread, "messages"> & {
  message_count: number;
  last_message?: { direction: "outbound" | "inbound"; date: string; preview: string };
};

function lightPreview(m?: EmailMessage): string {
  if (!m) return "";
  const t = m.body_text || (m.body_html ? m.body_html.replace(/<[^>]+>/g, " ") : "");
  return t.replace(/\s+/g, " ").trim().slice(0, 200);
}

function buildThreadIndex(all: Thread[]): ThreadLight[] {
  return all.map((t) => {
    const last = t.messages[t.messages.length - 1];
    const { messages, ...rest } = t;
    return {
      ...rest,
      message_count: t.messages.length,
      last_message: last ? { direction: last.direction, date: last.date, preview: lightPreview(last) } : undefined,
    };
  });
}

async function writeThreads(threads: Thread[]) {
  await writeJson(KEY, threads);
  // Reconstruir el índice ligero (best-effort: si falla, la lista cae al blob).
  try { await writeJson(INDEX_KEY, buildThreadIndex(threads)); } catch {}
}

export async function listThreads(): Promise<Thread[]> {
  const all = await readThreads();
  return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

/** Lista LIGERA (sin cuerpos de mensaje) para la vista de lista — rápida.
 *  Si el índice aún no existe (primera vez), lo construye desde el blob. */
export async function listThreadsLight(): Promise<ThreadLight[]> {
  let idx = await readJson<ThreadLight[]>(INDEX_KEY);
  if (!idx) {
    const all = await readThreads();
    idx = buildThreadIndex(all);
    try { await writeJson(INDEX_KEY, idx); } catch {}
  }
  return idx.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getThread(id: string): Promise<Thread | null> {
  const all = await readThreads();
  return all.find((t) => t.id === id) ?? null;
}

export async function findThreadBySubjectAndParticipant(subject: string, participant: string): Promise<Thread | null> {
  const all = await readThreads();
  const norm = (s: string) => s.replace(/^(re:|fwd?:)\s*/gi, "").trim().toLowerCase();
  return (
    all.find(
      (t) =>
        norm(t.subject) === norm(subject) &&
        t.participants.some((p) => p.toLowerCase().includes(participant.toLowerCase()))
    ) ?? null
  );
}

export async function findThreadByMessageId(messageId: string): Promise<Thread | null> {
  const all = await readThreads();
  return (
    all.find((t) =>
      t.messages.some(
        (m) => m.message_id === messageId || (m.references ?? []).includes(messageId) || m.in_reply_to === messageId
      )
    ) ?? null
  );
}

export async function createThread(input: {
  subject: string;
  participants: string[];
  notes?: string;
}): Promise<Thread> {
  const all = await readThreads();
  const now = new Date().toISOString();
  const t: Thread = {
    id: randomUUID(),
    subject: input.subject,
    participants: input.participants,
    messages: [],
    status: "active",
    followups: [],
    notes: input.notes,
    created_at: now,
    updated_at: now,
  };
  all.push(t);
  await writeThreads(all);
  return t;
}

export async function appendMessage(threadId: string, msg: Omit<EmailMessage, "id">): Promise<Thread | null> {
  const all = await readThreads();
  const t = all.find((x) => x.id === threadId);
  if (!t) return null;

  if (msg.message_id) {
    const exists = t.messages.some((x) => x.message_id === msg.message_id);
    if (exists) return t;
  }

  const m: EmailMessage = { id: randomUUID(), ...msg };
  t.messages.push(m);
  t.messages.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  if (m.direction === "inbound") t.last_inbound_at = m.date;
  else t.last_outbound_at = m.date;
  t.updated_at = new Date().toISOString();
  await writeThreads(all);
  return t;
}

export async function updateThread(id: string, patch: Partial<Thread>): Promise<Thread | null> {
  const all = await readThreads();
  const idx = all.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  all[idx] = { ...all[idx], ...patch, updated_at: new Date().toISOString() };
  await writeThreads(all);
  return all[idx];
}

export async function deleteThread(id: string) {
  const all = await readThreads();
  await writeThreads(all.filter((t) => t.id !== id));
}

// ===== Follow-ups =====

export async function scheduleFollowup(input: {
  thread_id: string;
  body_html: string;
  scheduled_at: string;
  origin: Followup["origin"];
  status?: Followup["status"];
}): Promise<Followup | null> {
  const all = await readThreads();
  const t = all.find((x) => x.id === input.thread_id);
  if (!t) return null;
  const f: Followup = {
    id: randomUUID(),
    thread_id: input.thread_id,
    body_html: input.body_html,
    scheduled_at: input.scheduled_at,
    status: input.status ?? "scheduled",
    origin: input.origin,
  };
  t.followups.push(f);
  t.updated_at = new Date().toISOString();
  await writeThreads(all);
  return f;
}

/**
 * Programa VARIOS follow-ups de un mismo thread en UNA sola operación
 * read-modify-write. Antes el cliente hacía un POST por paso y cada POST
 * leía+reescribía el blob entero de threads (5-10s cada uno) → con 5 pasos
 * se colgaba y el statement timeout cortaba todo. Esto lo hace de golpe.
 */
export async function scheduleFollowupsBatch(input: {
  thread_id: string;
  origin: Followup["origin"];
  steps: Array<{ body_html: string; scheduled_at: string }>;
}): Promise<{ scheduled: Followup[]; error?: string }> {
  if (!input.steps?.length) return { scheduled: [], error: "sin pasos" };
  const all = await readThreads();
  const t = all.find((x) => x.id === input.thread_id);
  if (!t) return { scheduled: [], error: "thread no encontrado" };
  const created: Followup[] = [];
  for (const step of input.steps) {
    // Marcador para que el follow-up se CANCELE si el prospect responde antes de
    // la fecha (la UI lo promete). Sin esto, se enviaba igual aunque respondieran.
    const body = step.body_html.includes("<!--send_if_no_reply-->")
      ? step.body_html
      : step.body_html + "<!--send_if_no_reply-->";
    const f: Followup = {
      id: randomUUID(),
      thread_id: input.thread_id,
      body_html: body,
      scheduled_at: new Date(step.scheduled_at).toISOString(),
      status: "scheduled",
      origin: input.origin,
    };
    t.followups.push(f);
    created.push(f);
  }
  t.updated_at = new Date().toISOString();
  await writeThreads(all); // UNA sola escritura para todos los pasos
  return { scheduled: created };
}

export async function updateFollowup(threadId: string, followupId: string, patch: Partial<Followup>): Promise<Followup | null> {
  const all = await readThreads();
  const t = all.find((x) => x.id === threadId);
  if (!t) return null;
  const idx = t.followups.findIndex((f) => f.id === followupId);
  if (idx === -1) return null;
  t.followups[idx] = { ...t.followups[idx], ...patch };
  t.updated_at = new Date().toISOString();
  await writeThreads(all);
  return t.followups[idx];
}

export async function deleteFollowup(threadId: string, followupId: string) {
  const all = await readThreads();
  const t = all.find((x) => x.id === threadId);
  if (!t) return;
  t.followups = t.followups.filter((f) => f.id !== followupId);
  t.updated_at = new Date().toISOString();
  await writeThreads(all);
}

export async function listAllScheduledFollowups(): Promise<Array<Followup & { thread: Thread }>> {
  const all = await readThreads();
  const out: Array<Followup & { thread: Thread }> = [];
  for (const t of all) {
    for (const f of t.followups) {
      if (f.status === "scheduled") out.push({ ...f, thread: t });
    }
  }
  return out;
}

/** Igual que listAllScheduledFollowups pero LIGERO (índice sin cuerpos de
 *  mensaje) — para la lista/calendario de /seguimientos. Rápido. */
export async function listAllScheduledFollowupsLight(): Promise<Array<Followup & { thread: ThreadLight }>> {
  const all = await listThreadsLight();
  const out: Array<Followup & { thread: ThreadLight }> = [];
  for (const t of all) {
    for (const f of t.followups) {
      if (f.status === "scheduled") out.push({ ...f, thread: t });
    }
  }
  return out;
}

/**
 * COMPACTACIÓN del blob email-threads.
 *
 * El scheduler lee TODO el blob cada 30s. Con cientos de threads viejos
 * cerrados acumulados, cada lectura tarda 5-10 SEGUNDOS y bloquea el
 * pool de Postgres → toda la app va lenta.
 *
 * Esta función mueve los threads que ya no necesitan procesarse (cerrados/
 * stale + sin follow-ups pendientes + sin actividad reciente) a una clave
 * de archivo separada `email-threads/archive`. El blob principal queda
 * con SOLO los threads activos.
 *
 * Devuelve: { keptActive, archivedNow, totalArchived }
 */
export async function compactThreads(opts?: { olderThanDays?: number }): Promise<{ keptActive: number; archivedNow: number; totalArchived: number }> {
  const olderThanDays = opts?.olderThanDays ?? 30;
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

  const all = await readThreads();
  const archive = (await readJson<Thread[]>("email-threads/archive")) ?? [];

  const active: Thread[] = [];
  const toArchive: Thread[] = [];

  for (const t of all) {
    const hasPendingFollowup = (t.followups || []).some(
      (f) => f.status === "scheduled" || f.status === "sending" || f.status === "pending_approval"
    );
    const updatedAt = new Date(t.updated_at).getTime();
    const isOld = updatedAt < cutoff;
    const isInactive = t.status === "closed" || t.status === "stale";
    // Archivamos solo si: inactivo Y viejo Y sin follow-up pendiente
    if (isInactive && isOld && !hasPendingFollowup) {
      toArchive.push(t);
    } else {
      active.push(t);
    }
  }

  if (toArchive.length > 0) {
    archive.push(...toArchive);
    await writeJson("email-threads/archive", archive);
    await writeThreads(active);
  }

  return {
    keptActive: active.length,
    archivedNow: toArchive.length,
    totalArchived: archive.length,
  };
}
