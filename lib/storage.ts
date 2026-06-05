/**
 * Capa unificada de storage:
 *  - Si DATABASE_URL está definido (Railway/prod) → usa Postgres KV.
 *  - Si no → usa filesystem (data/ local en dev).
 *
 * Los lib files llaman a readJson/writeJson/deleteJson en vez de fs.readFile/writeFile.
 * Así migrar a producción no requiere cambios de código.
 */
import { promises as fs } from "fs";
import path from "path";
import { getPool, ensureSchema, isDbEnabled, withClient } from "./db";
import { dataPath } from "./data-dir";

// ─────────────────────────────────────────────────────────────────────────────
// CACHÉ EN MEMORIA con TTL — elimina round-trips a Postgres en lecturas hot.
// Cada readJson() costaba 20-100ms (latencia DB). Con cache de 5s, una key
// leída 10 veces por minuto pasa de 600ms acumulados/min a 60ms (1 lectura
// real + 9 cache hits). Las escrituras invalidan automáticamente.
// ─────────────────────────────────────────────────────────────────────────────
type CacheEntry = { value: any; expires: number };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5_000; // 5s — muy corto, conservador pero efectivo
const CACHE_MAX_SIZE = 500; // evita memory leak en uniboxes grandes

function cacheGet(key: string): any | undefined {
  const e = CACHE.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    CACHE.delete(key);
    return undefined;
  }
  return e.value;
}
function cacheSet(key: string, value: any): void {
  if (CACHE.size >= CACHE_MAX_SIZE) {
    // Evict el más viejo (LRU simple — la primera key del Map es la más vieja).
    const firstKey = CACHE.keys().next().value;
    if (firstKey) CACHE.delete(firstKey);
  }
  CACHE.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}
function cacheInvalidate(key: string): void {
  CACHE.delete(key);
}

// Contadores globales para diagnóstico
let _cacheHits = 0;
let _cacheMisses = 0;
let _slowQueries: Array<{ key: string; ms: number; ts: number }> = [];

export function getStorageStats() {
  return {
    cache_hits: _cacheHits,
    cache_misses: _cacheMisses,
    hit_rate: _cacheHits / (_cacheHits + _cacheMisses || 1),
    cache_size: CACHE.size,
    slow_queries_last_100: _slowQueries.slice(-100),
  };
}

/** Lee un valor JSON por clave. Devuelve null si no existe. */
export async function readJson<T = any>(key: string): Promise<T | null> {
  // Fast path: cache hit
  const cached = cacheGet(key);
  if (cached !== undefined) { _cacheHits++; return cached; }
  _cacheMisses++;

  if (isDbEnabled()) {
    await ensureSchema();
    const t0 = Date.now();
    const r = await withClient((c) => c.query<{ value: T }>("SELECT value FROM kv_store WHERE key = $1", [key]));
    const ms = Date.now() - t0;
    if (ms > 200) {
      _slowQueries.push({ key, ms, ts: Date.now() });
      if (_slowQueries.length > 500) _slowQueries = _slowQueries.slice(-200);
      console.warn(`[storage] SLOW readJson ${key} → ${ms}ms`);
    }
    if (r.rows[0]) {
      cacheSet(key, r.rows[0].value);
      return r.rows[0].value;
    }
    // Auto-seed: si no está en Postgres pero hay un archivo bundled en el repo,
    // lo cargamos y lo escribimos a Postgres para futuras lecturas.
    try {
      const filePath = keyToPath(key);
      const raw = await fs.readFile(filePath, "utf-8");
      const value = JSON.parse(raw) as T;
      await writeJson(key, value).catch(() => {});
      cacheSet(key, value);
      return value;
    } catch {
      cacheSet(key, null); // cachear el "no existe" también
      return null;
    }
  }
  // Modo dev: lectura directa de fs
  try {
    const filePath = keyToPath(key);
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Guarda un valor JSON por clave. Sobrescribe si existe.
 *  En producción (DATABASE_URL set) escribe a Postgres. Si Postgres falla,
 *  LANZA el error en vez de caer a fs (que en Railway se pierde en cada restart).
 *  En dev (sin DATABASE_URL) escribe a fs local. */
export async function writeJson(key: string, value: any): Promise<void> {
  // Update cache inmediato (write-through): la próxima lectura ya ve el valor.
  cacheSet(key, value);
  if (isDbEnabled()) {
    try {
      await ensureSchema();
      await withClient((c) =>
        c.query(
          `INSERT INTO kv_store (key, value, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
          [key, JSON.stringify(value)]
        )
      );
      return;
    } catch (e: any) {
      // Si el write a DB falla, invalidamos el cache para que la próxima
      // lectura vaya a DB (no sirva valor que no se persistió).
      cacheInvalidate(key);
      console.error(`[storage] FATAL: writeJson Postgres falló para key=${key}:`, e.message);
      throw new Error(`Postgres write failed: ${e.message}`);
    }
  }
  // Fallback fs (sólo dev local)
  const filePath = keyToPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

/** Borra una entrada por clave. */
export async function deleteJson(key: string): Promise<void> {
  cacheInvalidate(key);
  if (isDbEnabled()) {
    await ensureSchema();
    await withClient((c) => c.query("DELETE FROM kv_store WHERE key = $1", [key]));
    return;
  }
  const filePath = keyToPath(key);
  await fs.unlink(filePath).catch(() => {});
}

/** Lista las claves que empiezan por un prefijo (útil para "directorios" como memory/) */
export async function listKeys(prefix: string): Promise<string[]> {
  if (isDbEnabled()) {
    await ensureSchema();
    const r = await withClient((c) =>
      c.query<{ key: string }>("SELECT key FROM kv_store WHERE key LIKE $1 ORDER BY key", [`${prefix}%`])
    );
    return r.rows.map((row) => row.key);
  }
  // Fallback fs: si la clave es tipo "memory/" listamos los archivos en data/memory/
  try {
    const dir = keyToPath(prefix);
    const stat = await fs.stat(dir).catch(() => null);
    if (stat?.isDirectory()) {
      const files = await fs.readdir(dir);
      return files.map((f) => path.posix.join(prefix, f));
    }
    return [];
  } catch {
    return [];
  }
}

/** Lee un blob binario (imágenes, etc.) */
export async function readBlob(key: string): Promise<{ data: Buffer; mime: string } | null> {
  if (isDbEnabled()) {
    await ensureSchema();
    const r = await withClient((c) =>
      c.query<{ data: Buffer; mime: string }>("SELECT data, mime FROM blob_store WHERE key = $1", [key])
    );
    return r.rows[0] ?? null;
  }
  try {
    const filePath = keyToPath(key);
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      ext === ".gif" ? "image/gif" :
      ext === ".png" ? "image/png" :
      "application/octet-stream";
    return { data, mime };
  } catch {
    return null;
  }
}

/** Guarda un blob binario */
export async function writeBlob(key: string, data: Buffer, mime: string = "application/octet-stream"): Promise<void> {
  if (isDbEnabled()) {
    await ensureSchema();
    await withClient((c) =>
      c.query(
        `INSERT INTO blob_store (key, mime, data, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = NOW()`,
        [key, mime, data]
      )
    );
    return;
  }
  const filePath = keyToPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

/** Convierte una clave tipo "memory/foo" o "email-threads" a ruta de filesystem */
function keyToPath(key: string): string {
  const hasExt = /\.[a-z0-9]+$/i.test(key);
  const segments = key.split("/").filter(Boolean);
  if (segments.length === 0) return dataPath(key);
  // Si no hay extensión, añadimos .json al último segmento
  if (!hasExt) {
    segments[segments.length - 1] = `${segments[segments.length - 1]}.json`;
  }
  return dataPath(...segments);
}
