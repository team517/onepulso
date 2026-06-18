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
const CACHE_MAX_SIZE = 150; // bajado de 1000 → menos RAM
// NO cachear valores grandes (los mapas de mensajes del unibox pueden ser
// MB). Cachear esos blobs en memoria disparaba el uso de RAM a 5GB+.
// Solo cacheamos cosas pequeñas (cuentas, folders, config) que es donde
// la fluidez importa. Los blobs grandes se leen de Postgres (rápido igual).
const CACHE_MAX_VALUE_CHARS = 256 * 1024; // 256 KB por entrada máx

// CLAVES "CALIENTES" grandes que SÍ merece la pena cachear brevemente: se
// leen muchas veces seguidas (la lista de /seguimientos lee este blob ~4
// veces al cargar + en cada poll). Cachear UNA copia unos segundos es barato
// en RAM; lo que disparaba la RAM a 5GB era cachear DECENAS de blobs de
// mensajes de unibox a la vez, no este único blob. Sin esto, cada lectura
// deserializa varios MB desde Postgres → /seguimientos va lento.
const HOT_LARGE_KEYS = new Set(["email-threads"]);
const HOT_LARGE_MAX_CHARS = 8 * 1024 * 1024; // 8 MB tope para claves calientes
const HOT_LARGE_TTL_MS = 15_000; // TTL un poco mayor para cubrir el polling

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
  const isHot = HOT_LARGE_KEYS.has(key);
  const maxChars = isHot ? HOT_LARGE_MAX_CHARS : CACHE_MAX_VALUE_CHARS;
  // Skip blobs grandes — no queremos GB de mensajes en RAM.
  try {
    if (value && typeof value === "object") {
      const approxSize = JSON.stringify(value).length;
      if (approxSize > maxChars) {
        _cache.delete(key); // por si había una versión vieja
        return;
      }
    }
  } catch {
    return; // si no se puede serializar, no cachear
  }
  if (_cache.size >= CACHE_MAX_SIZE) {
    const firstKey = _cache.keys().next().value;
    if (firstKey) _cache.delete(firstKey);
  }
  _cache.set(key, { value, expires: Date.now() + (isHot ? HOT_LARGE_TTL_MS : CACHE_TTL_MS) });
}
function cacheInvalidate(key: string): void {
  _cache.delete(key);
}

// SINGLE-FLIGHT: si varias peticiones piden la MISMA clave a la vez (p.ej. la
// página de seguimientos dispara /threads + /followups + /contract-alerts +
// /pending casi simultáneamente, todas leen "email-threads"), solo se ejecuta
// UNA consulta a la BD; las demás esperan a esa misma promesa. Esto evita la
// "avalancha" de consultas idénticas que agotaba el pool y colgaba la app.
const _inflightReads = new Map<string, Promise<any>>();

/** Lee un valor JSON por clave. Devuelve null si no existe. */
export async function readJson<T = any>(key: string): Promise<T | null> {
  // Fast path: cache hit
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  // ¿Ya hay una lectura de esta misma clave en curso? Reutilízala.
  const inflight = _inflightReads.get(key);
  if (inflight) return inflight as Promise<T | null>;

  const p = (async (): Promise<T | null> => {
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
  })();

  _inflightReads.set(key, p);
  try {
    return await p;
  } finally {
    _inflightReads.delete(key);
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
