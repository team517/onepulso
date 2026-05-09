import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import {
  appendMessage,
  getThread,
  scheduleFollowup,
  Thread,
} from "./email-threads";
import { dataPath } from "./data-dir";

const FILE = dataPath("email-sequences.json");

export type SequenceStep = {
  delay_days: number; // días después del paso anterior (o del initial si es step 1)
  body_html: string;
  send_if_no_reply: boolean; // si true, se cancela si el prospect respondió antes de la fecha
  note?: string; // descripción humana del propósito del step
};

export type Sequence = {
  id: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
  created_at: string;
  updated_at: string;
};

async function readAll(): Promise<Sequence[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {
    return [];
  }
}

async function writeAll(items: Sequence[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(items, null, 2), "utf-8");
}

export async function listSequences(): Promise<Sequence[]> {
  const all = await readAll();
  return all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getSequence(id: string): Promise<Sequence | null> {
  const all = await readAll();
  return all.find((s) => s.id === id) ?? null;
}

export async function saveSequence(input: {
  id?: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
}): Promise<Sequence> {
  const all = await readAll();
  const now = new Date().toISOString();
  if (input.id) {
    const idx = all.findIndex((s) => s.id === input.id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...input, id: all[idx].id, updated_at: now };
      await writeAll(all);
      return all[idx];
    }
  }
  const seq: Sequence = {
    id: randomUUID(),
    name: input.name,
    description: input.description,
    steps: input.steps,
    created_at: now,
    updated_at: now,
  };
  all.push(seq);
  await writeAll(all);
  return seq;
}

export async function deleteSequence(id: string) {
  const all = await readAll();
  await writeAll(all.filter((s) => s.id !== id));
}

/**
 * Aplica una secuencia a un thread: programa N follow-ups con sus delays acumulados.
 * El delay de cada step es relativo al step ANTERIOR (o al envío inicial para el step 1).
 */
export async function applySequence(opts: {
  sequence_id: string;
  thread_id: string;
  base_date?: string; // por defecto = ahora (envío inicial)
}): Promise<{ scheduled: number; followup_ids: string[] }> {
  const seq = await getSequence(opts.sequence_id);
  if (!seq) throw new Error(`sequence ${opts.sequence_id} no encontrada`);
  const thread = await getThread(opts.thread_id);
  if (!thread) throw new Error(`thread ${opts.thread_id} no encontrado`);

  const baseDate = opts.base_date ? new Date(opts.base_date) : new Date();
  let cumulativeMs = 0;
  const ids: string[] = [];

  for (const step of seq.steps) {
    cumulativeMs += step.delay_days * 24 * 60 * 60 * 1000;
    const scheduledAt = new Date(baseDate.getTime() + cumulativeMs).toISOString();
    const f = await scheduleFollowup({
      thread_id: opts.thread_id,
      body_html: step.body_html + (step.send_if_no_reply ? `<!--send_if_no_reply-->` : ""),
      scheduled_at: scheduledAt,
      origin: "manual",
    });
    if (f) ids.push(f.id);
  }
  return { scheduled: ids.length, followup_ids: ids };
}

/**
 * Marca un follow-up como send_if_no_reply (lo embebemos en HTML como comentario).
 */
export function isSendIfNoReply(body_html: string): boolean {
  return body_html.includes("<!--send_if_no_reply-->");
}
export function stripConditionMarkers(body_html: string): string {
  return body_html.replace(/<!--send_if_no_reply-->/g, "");
}
