import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "notes";

export type Note = {
  id: string;
  title?: string;
  content: string;
  pinned?: boolean;
  color?: "yellow" | "blue" | "green" | "pink" | "purple" | "gray";
  tags?: string[];
  created_at: string;
  updated_at: string;
};

export async function listNotes(): Promise<Note[]> {
  return (await readJson<Note[]>(KEY)) ?? [];
}

async function saveAll(notes: Note[]) {
  await writeJson(KEY, notes);
}

export async function createNote(input: Partial<Note> & { content: string }): Promise<Note> {
  const notes = await listNotes();
  const now = new Date().toISOString();
  const note: Note = {
    id: randomUUID(),
    title: input.title?.trim() || undefined,
    content: input.content,
    pinned: input.pinned || false,
    color: input.color || "yellow",
    tags: input.tags || [],
    created_at: now,
    updated_at: now,
  };
  notes.push(note);
  await saveAll(notes);
  return note;
}

export async function updateNote(id: string, patch: Partial<Note>): Promise<Note | null> {
  const notes = await listNotes();
  const idx = notes.findIndex((n) => n.id === id);
  if (idx === -1) return null;
  notes[idx] = {
    ...notes[idx],
    ...patch,
    id: notes[idx].id,
    created_at: notes[idx].created_at,
    updated_at: new Date().toISOString(),
  };
  await saveAll(notes);
  return notes[idx];
}

export async function deleteNote(id: string): Promise<void> {
  const notes = await listNotes();
  await saveAll(notes.filter((n) => n.id !== id));
}
