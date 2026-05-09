import { randomUUID } from "crypto";
import { readJson, writeJson, deleteJson, listKeys } from "./storage";

const PREFIX = "conversations/";

export type ConvMessage = {
  role: "user" | "assistant";
  text?: string;
  events?: Array<{ type: string; data: any }>;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ConvMessage[];
  created_at: string;
  updated_at: string;
};

export type ConversationSummary = Pick<Conversation, "id" | "title" | "created_at" | "updated_at">;

export async function listConversations(): Promise<ConversationSummary[]> {
  const keys = await listKeys(PREFIX);
  const out: ConversationSummary[] = [];
  for (const k of keys) {
    const c = await readJson<Conversation>(k);
    if (c) out.push({ id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at });
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  return await readJson<Conversation>(`${PREFIX}${id}`);
}

export async function createConversation(firstUserText?: string): Promise<Conversation> {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: randomUUID(),
    title: titleFrom(firstUserText) || "Nueva conversación",
    messages: [],
    created_at: now,
    updated_at: now,
  };
  await writeJson(`${PREFIX}${conv.id}`, conv);
  return conv;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  conv.updated_at = new Date().toISOString();
  if (!conv.title || conv.title === "Nueva conversación") {
    const firstUser = conv.messages.find((m) => m.role === "user");
    if (firstUser?.text) conv.title = titleFrom(firstUser.text);
  }
  await writeJson(`${PREFIX}${conv.id}`, conv);
}

export async function deleteConversation(id: string): Promise<void> {
  await deleteJson(`${PREFIX}${id}`);
}

function titleFrom(text?: string): string {
  if (!text) return "Nueva conversación";
  const clean = text.replace(/\[.+?\]/g, "").trim().split("\n")[0];
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean || "Nueva conversación";
}
