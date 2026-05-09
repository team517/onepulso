import { readJson, writeJson, deleteJson, listKeys } from "./storage";

const PREFIX = "memory/";

export type MemoryEntry = {
  slug: string;
  title: string;
  category: string;
  content: string;
  updated: string;
};

function safeSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export async function listMemory(): Promise<MemoryEntry[]> {
  const keys = await listKeys(PREFIX);
  const entries: MemoryEntry[] = [];
  for (const k of keys) {
    const e = await readJson<MemoryEntry>(k);
    if (e) entries.push(e);
  }
  return entries.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
}

export async function getMemory(slug: string): Promise<MemoryEntry | null> {
  return await readJson<MemoryEntry>(`${PREFIX}${slug}`);
}

export async function saveMemory(input: {
  slug?: string;
  title: string;
  category: string;
  content: string;
}): Promise<MemoryEntry> {
  const slug = input.slug ?? safeSlug(input.title);
  const entry: MemoryEntry = {
    slug,
    title: input.title,
    category: input.category,
    content: input.content,
    updated: new Date().toISOString(),
  };
  await writeJson(`${PREFIX}${slug}`, entry);
  return entry;
}

export async function deleteMemory(slug: string) {
  await deleteJson(`${PREFIX}${slug}`);
}

export async function memoryAsContext(): Promise<string> {
  const all = await listMemory();
  if (all.length === 0) return "(sin memoria configurada todavía)";
  return all.map((e) => `### [${e.category}] ${e.title}\n${e.content}`).join("\n\n---\n\n");
}
