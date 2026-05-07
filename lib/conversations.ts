import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

const DIR = path.join(process.cwd(), "data", "conversations");

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

async function ensureDir() {
  await fs.mkdir(DIR, { recursive: true });
}

export async function listConversations(): Promise<ConversationSummary[]> {
  await ensureDir();
  const files = await fs.readdir(DIR);
  const out: ConversationSummary[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(DIR, f), "utf-8");
      const c: Conversation = JSON.parse(raw);
      out.push({ id: c.id, title: c.title, created_at: c.created_at, updated_at: c.updated_at });
    } catch {
      /* skip corrupt */
    }
  }
  return out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getConversation(id: string): Promise<Conversation | null> {
  await ensureDir();
  try {
    const raw = await fs.readFile(path.join(DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function createConversation(firstUserText?: string): Promise<Conversation> {
  await ensureDir();
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: randomUUID(),
    title: titleFrom(firstUserText) || "Nueva conversación",
    messages: [],
    created_at: now,
    updated_at: now,
  };
  await fs.writeFile(path.join(DIR, `${conv.id}.json`), JSON.stringify(conv, null, 2), "utf-8");
  return conv;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  await ensureDir();
  conv.updated_at = new Date().toISOString();
  if (!conv.title || conv.title === "Nueva conversación") {
    const firstUser = conv.messages.find((m) => m.role === "user");
    if (firstUser?.text) conv.title = titleFrom(firstUser.text);
  }
  await fs.writeFile(path.join(DIR, `${conv.id}.json`), JSON.stringify(conv, null, 2), "utf-8");
}

export async function deleteConversation(id: string): Promise<void> {
  await fs.unlink(path.join(DIR, `${id}.json`)).catch(() => {});
}

function titleFrom(text?: string): string {
  if (!text) return "Nueva conversación";
  const clean = text.replace(/\[.+?\]/g, "").trim().split("\n")[0];
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean || "Nueva conversación";
}
