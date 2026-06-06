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
// CACHE EN MEMORIA — hace todo instantáneo. Lecturas que ya están en
// memoria devuelven sin tocar Postgres. Se invalida automáticamente al
// escribir o tras TTL.
// ─────────────────────────────────────────────────────────────────────────────
type CacheEntry = { value: any; expires: number };
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5_000; // 5s — corto, suficiente para fluidez sin staleness
const CACHE_MAX_SIZE = 1000;

function cacheGet(key: string): any | undefined {
  const e = _cache.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    _cache.delete(key);
    return undefined;
  }
  return e.value;
}
function cacheSet(key: string, value: any): void {
  if (_cache.size >= CACHE_MAX_SIZE) {
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
  _cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}
function cacheInvalidate(key: string): void {
  _cache.delete(key);
}

/** Lee un valor JSON por clave. Devuelve null si no existe. */
export async function readJson<T = any>(key: string): Promise<T | null> {
  // Fast path: cache hit
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  if (isDbEnabled()) {
    await ensureSchema();
    const r = await withClient((c) => c.query<{ value: T }>("SELECT value FROM kv_store WHERE key = $1", [key]));
    const value = r.rows[0]?.value ?? null;
    cacheSet(key, value);
    return value;
  }
  // Fallback fs
  try {
    const filePath = keyToPath(key);
    const raw = await fs.readFile(filePath, "utf-8");
    const value = JSON.parse(raw) as T;
    cacheSet(key, value);
    return value;
  } catch {
    cacheSet(key, null);
    return null;
  }
}

/** Guarda un valor JSON por clave. Sobrescribe si existe. */
export async function writeJson(key: string, value: any): Promise<void> {
  // Update cache inmediato (write-through) — próxima lectura ya ve el valor
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
    } catch (e) {
      cacheInvalidate(key); // si falla, invalidar para no servir valor no persistido
      throw e;
    }
  }
  // Fallback fs
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
  // Si la clave NO termina en .json y no tiene extensión, asumimos JSON
  const hasExt = /\.[a-z0-9]+$/i.test(key);
  const segments = key.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!hasExt && segments.length === 1) {
    return dataPath(`${last}.json`);
  }
  return dataPath(...segments);
}
