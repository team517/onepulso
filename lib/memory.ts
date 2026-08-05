import { promises as fs } from "fs";
import path from "path";
import { readJson, writeJson, deleteJson, listKeys } from "./storage";
import { dataPath } from "./data-dir";
import { isDbEnabled } from "./db";
import {
  isSupabaseMemoryEnabled,
  sbListMemory,
  sbGetMemory,
  sbSaveMemory,
  sbDeleteMemory,
} from "./supabase-memory";

const PREFIX = "memory/";

/**
 * Carpeta de la memoria SEMILLA (los .md incluidos en el repo: identity, framework,
 * estructura de copy…). SIEMPRE se lee del código, NO de DATA_DIR: DATA_DIR apunta a
 * un volumen para datos de usuario y NO contiene estos .md, así que usar dataPath()
 * aquí dejaba la memoria vacía en producción → los prompts salían sin la "voz".
 */
function bundledMemoryDir(): string {
  return path.join(process.cwd(), "data", "memory");
}

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

/** Lee el frontmatter YAML de un .md legacy */
function parseFrontmatter(raw: string): { meta: any; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: raw };
  const meta: any = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

/** Lee TODAS las entradas — Postgres + filesystem (.md bundled o legacy). Auto-importa .md a Postgres. */
export async function listMemory(): Promise<MemoryEntry[]> {
  // Si Supabase está configurado, la memoria vive allí.
  if (isSupabaseMemoryEnabled()) {
    try {
      const found = new Map<string, MemoryEntry>();
      for (const e of await sbListMemory()) found.set(e.slug, e);
      // Auto-import de los .md incluidos en el repo si aún no están en Supabase.
      try {
        const dir = bundledMemoryDir();
        const files = await fs.readdir(dir).catch(() => []);
        for (const f of files) {
          if (!f.endsWith(".md")) continue;
          const slug = f.replace(/\.md$/, "");
          if (found.has(slug)) continue;
          const raw = await fs.readFile(path.join(dir, f), "utf-8").catch(() => "");
          if (!raw) continue;
          const parsed = parseFrontmatter(raw);
          const entry: MemoryEntry = {
            slug, title: parsed.meta.title ?? slug,
            category: parsed.meta.category ?? "general",
            content: parsed.body, updated: new Date().toISOString(),
          };
          found.set(slug, entry);
          await sbSaveMemory(entry).catch(() => {});
        }
      } catch {}
      return [...found.values()].sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
    } catch (e: any) {
      console.warn("[memory] Supabase list falló, fallback a KV:", e?.message);
      // sigue al flujo normal (KV/fs) para no romper la app.
    }
  }

  const found = new Map<string, MemoryEntry>();

  // 1) Leer de Postgres / KV
  const keys = await listKeys(PREFIX);
  for (const k of keys) {
    const e = await readJson<MemoryEntry>(k);
    if (e && e.slug) found.set(e.slug, e);
  }

  // 2) Leer .md del repo / filesystem y auto-importar a Postgres si no estaban
  try {
    const dir = bundledMemoryDir();
    const files = await fs.readdir(dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      try {
        const full = path.join(dir, f);
        const raw = await fs.readFile(full, "utf-8");
        const stat = await fs.stat(full);
        const parsed = parseFrontmatter(raw);
        const slug = f.replace(/\.md$/, "");
        if (!found.has(slug)) {
          const entry: MemoryEntry = {
            slug,
            title: parsed.meta.title ?? slug,
            category: parsed.meta.category ?? "general",
            content: parsed.body,
            updated: stat.mtime.toISOString(),
          };
          found.set(slug, entry);
          // Auto-import a Postgres si está activo (sólo primera vez)
          if (isDbEnabled()) {
            await writeJson(`${PREFIX}${slug}`, entry).catch(() => {});
          }
        }
      } catch {}
    }
  } catch {}

  return [...found.values()].sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
}

export async function getMemory(slug: string): Promise<MemoryEntry | null> {
  if (isSupabaseMemoryEnabled()) {
    try { return await sbGetMemory(slug); }
    catch (e: any) { console.warn("[memory] Supabase get falló, fallback a KV:", e?.message); }
  }
  const j = await readJson<MemoryEntry>(`${PREFIX}${slug}`);
  if (j) return j;

  // Fallback: intentar leer el .md semilla del repo (siempre, no solo sin DB).
  try {
    const full = path.join(bundledMemoryDir(), `${slug}.md`);
    const raw = await fs.readFile(full, "utf-8");
    const stat = await fs.stat(full);
    const parsed = parseFrontmatter(raw);
    return {
      slug,
      title: parsed.meta.title ?? slug,
      category: parsed.meta.category ?? "general",
      content: parsed.body,
      updated: stat.mtime.toISOString(),
    };
  } catch {}
  return null;
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
  if (isSupabaseMemoryEnabled()) {
    await sbSaveMemory(entry); // si falla, lanza (la UI muestra el error)
    return entry;
  }
  await writeJson(`${PREFIX}${slug}`, entry);
  return entry;
}

export async function deleteMemory(slug: string) {
  if (isSupabaseMemoryEnabled()) {
    await sbDeleteMemory(slug);
    return;
  }
  await deleteJson(`${PREFIX}${slug}`);
  // También borrar .md legacy si existe (sólo en fs)
  if (!isDbEnabled()) {
    await fs.unlink(dataPath("memory", `${slug}.md`)).catch(() => {});
  }
}

export async function memoryAsContext(): Promise<string> {
  const all = await listMemory();
  if (all.length === 0) return "(sin memoria configurada todavía)";
  return all.map((e) => `### [${e.category}] ${e.title}\n${e.content}`).join("\n\n---\n\n");
}
