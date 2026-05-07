import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const FILE = path.join(process.cwd(), "data", "email-threads.json");

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
  auto_pilot?: boolean; // Si true, la IA procesa cada nueva inbound: extrae fecha + redacta + programa
  auto_pilot_processed_msg_ids?: string[]; // mensajes inbound ya procesados por auto-pilot
  created_at: string;
  updated_at: string;
};

export type Followup = {
  id: string;
  thread_id: string;
  body_html: string;
  scheduled_at: string;
  status: "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  origin: "manual" | "ai_auto" | "ai_assisted";
  error?: string;
  sent_at?: string;
  sent_message_id?: string;
};

async function readThreads(): Promise<Thread[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function writeThreads(threads: Thread[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(threads, null, 2), "utf-8");
}

export async function listThreads(): Promise<Thread[]> {
  const all = await readThreads();
  return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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
  const m: EmailMessage = { id: randomUUID(), ...msg };
  t.messages.push(m);
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
}): Promise<Followup | null> {
  const all = await readThreads();
  const t = all.find((x) => x.id === input.thread_id);
  if (!t) return null;
  const f: Followup = {
    id: randomUUID(),
    thread_id: input.thread_id,
    body_html: input.body_html,
    scheduled_at: input.scheduled_at,
    status: "scheduled",
    origin: input.origin,
  };
  t.followups.push(f);
  t.updated_at = new Date().toISOString();
  await writeThreads(all);
  return f;
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
