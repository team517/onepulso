/**
 * MEMORIA EN SUPABASE (opcional).
 *
 * Si están definidas las variables de entorno SUPABASE_URL + SUPABASE_KEY,
 * la memoria se guarda/lee de una tabla `memory` en Supabase (vía su API REST,
 * PostgREST). Si NO están, todo el sistema de memoria sigue usando el
 * almacenamiento normal (Postgres/KV de Railway) sin cambios.
 *
 * TABLA (créala en Supabase → SQL editor):
 *   create table if not exists public.memory (
 *     slug text primary key,
 *     title text not null default '',
 *     category text not null default 'general',
 *     content text not null default '',
 *     updated timestamptz not null default now()
 *   );
 *
 * ACCESO: con la key "publishable"/anon necesitas que la tabla permita a `anon`
 * (RLS desactivado o políticas allow-all). Para producción es más seguro usar
 * la key `service_role` (secreta) y dejar RLS activado.
 */
import type { MemoryEntry } from "./memory";

export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

export function isSupabaseMemoryEnabled(): boolean {
  return !!getSupabaseConfig();
}

function headers(cfg: { key: string }, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: cfg.key,
    Authorization: `Bearer ${cfg.key}`,
    "Content-Type": "application/json",
    ...(extra || {}),
  };
}

function rowToEntry(r: any): MemoryEntry {
  return {
    slug: r.slug,
    title: r.title ?? r.slug,
    category: r.category ?? "general",
    content: r.content ?? "",
    updated: r.updated ? new Date(r.updated).toISOString() : new Date().toISOString(),
  };
}

/** Lista todas las entradas de la tabla memory. */
export async function sbListMemory(): Promise<MemoryEntry[]> {
  const cfg = getSupabaseConfig();
  if (!cfg) return [];
  const res = await fetch(`${cfg.url}/rest/v1/memory?select=slug,title,category,content,updated&order=updated.desc`, {
    headers: headers(cfg),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase list ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()) as any[];
  return rows.map(rowToEntry);
}

/** Lee una entrada por slug. */
export async function sbGetMemory(slug: string): Promise<MemoryEntry | null> {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  const res = await fetch(`${cfg.url}/rest/v1/memory?slug=eq.${encodeURIComponent(slug)}&select=slug,title,category,content,updated&limit=1`, {
    headers: headers(cfg),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Supabase get ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = (await res.json()) as any[];
  return rows[0] ? rowToEntry(rows[0]) : null;
}

/** Inserta o actualiza (upsert por slug). */
export async function sbSaveMemory(entry: MemoryEntry): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg) return;
  const res = await fetch(`${cfg.url}/rest/v1/memory?on_conflict=slug`, {
    method: "POST",
    headers: headers(cfg, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify([{
      slug: entry.slug,
      title: entry.title,
      category: entry.category,
      content: entry.content,
      updated: entry.updated,
    }]),
  });
  if (!res.ok) throw new Error(`Supabase save ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/** Borra una entrada por slug. */
export async function sbDeleteMemory(slug: string): Promise<void> {
  const cfg = getSupabaseConfig();
  if (!cfg) return;
  const res = await fetch(`${cfg.url}/rest/v1/memory?slug=eq.${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: headers(cfg, { Prefer: "return=minimal" }),
  });
  if (!res.ok) throw new Error(`Supabase delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
