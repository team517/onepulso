import { promises as fs } from "fs";
import path from "path";

const MEM_DIR = path.join(process.cwd(), "data", "memory");

export type MemoryEntry = {
  slug: string;
  title: string;
  category: string;
  content: string;
  updated: string;
};

async function ensureDir() {
  await fs.mkdir(MEM_DIR, { recursive: true });
}

function safeSlug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

export async function listMemory(): Promise<MemoryEntry[]> {
  await ensureDir();
  const files = await fs.readdir(MEM_DIR);
  const entries: MemoryEntry[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const full = path.join(MEM_DIR, f);
    const raw = await fs.readFile(full, "utf-8");
    const parsed = parseFrontmatter(raw);
    const stat = await fs.stat(full);
    entries.push({
      slug: f.replace(/\.md$/, ""),
      title: parsed.meta.title ?? f.replace(/\.md$/, ""),
      category: parsed.meta.category ?? "general",
      content: parsed.body,
      updated: stat.mtime.toISOString(),
    });
  }
  return entries.sort((a, b) => b.updated.localeCompare(a.updated));
}

export async function getMemory(slug: string): Promise<MemoryEntry | null> {
  const all = await listMemory();
  return all.find((e) => e.slug === slug) ?? null;
}

export async function saveMemory(input: {
  slug?: string;
  title: string;
  category: string;
  content: string;
}): Promise<MemoryEntry> {
  await ensureDir();
  const slug = input.slug ?? safeSlug(input.title);
  const file = path.join(MEM_DIR, `${slug}.md`);
  const fm = `---\ntitle: ${input.title}\ncategory: ${input.category}\n---\n\n${input.content}\n`;
  await fs.writeFile(file, fm, "utf-8");
  return {
    slug,
    title: input.title,
    category: input.category,
    content: input.content,
    updated: new Date().toISOString(),
  };
}

export async function deleteMemory(slug: string) {
  const file = path.join(MEM_DIR, `${slug}.md`);
  await fs.unlink(file).catch(() => {});
}

export async function memoryAsContext(): Promise<string> {
  const all = await listMemory();
  if (all.length === 0) return "(sin memoria configurada todavía)";
  return all
    .map((e) => `### [${e.category}] ${e.title}\n${e.content}`)
    .join("\n\n---\n\n");
}

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: raw };
  const fmRaw = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trimStart();
  const meta: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  return { meta, body };
}
