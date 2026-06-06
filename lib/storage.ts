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

/** Timeout en ms para cada query de base de datos. Si se supera, la operación
 *  devuelve null/void en lugar de quedarse colgada indefinidamente. */
const DB_QUERY_TIMEOUT_MS = 5_000;

/**
 * Envuelve una promesa de base de datos con un timeout.
 * Si la promesa no resuelve en `timeoutMs`, rechaza con un error de timeout.
 */
function withDbTimeout<T>(promise: Promise<T>, timeoutMs = DB_QUERY_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[storage] DB query timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Lee un valor JSON por clave. Devuelve null si no existe o si la DB no responde. */
export async function readJson<T = any>(key: string): Promise<T | null> {
  if (isDbEnabled()) {
    try {
      await withDbTimeout(ensureSchema());
      const r = await withDbTimeout(
        withClient((c) => c.query<{ value: T }>("SELECT value FROM kv_store WHERE key = $1", [key]))
      );
      return r.rows[0]?.value ?? null;
    } catch (err: any) {
      console.error(`[storage] readJson("${key}") failed:`, err.message);
      return null;
    }
  }
  // Fallback fs
  try {
    const filePath = keyToPath(key);
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Guarda un valor JSON por clave. Sobrescribe si existe. */
export async function writeJson(key: string, value: any): Promise<void> {
  if (isDbEnabled()) {
    try {
      await withDbTimeout(ensureSchema());
      await withDbTimeout(
        withClient((c) =>
          c.query(
            `INSERT INTO kv_store (key, value, updated_at)
             VALUES ($1, $2::jsonb, NOW())
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
            [key, JSON.stringify(value)]
          )
        )
      );
    } catch (err: any) {
      console.error(`[storage] writeJson("${key}") failed:`, err.message);
      throw err;
    }
    return;
  }
  // Fallback fs
  const filePath = keyToPath(key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

/** Borra una entrada por clave. */
export async function deleteJson(key: string): Promise<void> {
  if (isDbEnabled()) {
    try {
      await withDbTimeout(ensureSchema());
      await withDbTimeout(
        withClient((c) => c.query("DELETE FROM kv_store WHERE key = $1", [key]))
      );
    } catch (err: any) {
      console.error(`[storage] deleteJson("${key}") failed:`, err.message);
      throw err;
    }
    return;
  }
  const filePath = keyToPath(key);
  await fs.unlink(filePath).catch(() => {});
}

/** Lista las claves que empiezan por un prefijo (útil para "directorios" como memory/) */
export async function listKeys(prefix: string): Promise<string[]> {
  if (isDbEnabled()) {
    try {
      await withDbTimeout(ensureSchema());
      const r = await withDbTimeout(
        withClient((c) =>
          c.query<{ key: string }>("SELECT key FROM kv_store WHERE key LIKE $1 ORDER BY key", [`${prefix}%`])
        )
      );
      return r.rows.map((row) => row.key);
    } catch (err: any) {
      console.error(`[storage] listKeys("${prefix}") failed:`, err.message);
      return [];
    }
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
    try {
      await withDbTimeout(ensureSchema());
      const r = await withDbTimeout(
        withClient((c) =>
          c.query<{ data: Buffer; mime: string }>("SELECT data, mime FROM blob_store WHERE key = $1", [key])
        )
      );
      return r.rows[0] ?? null;
    } catch (err: any) {
      console.error(`[storage] readBlob("${key}") failed:`, err.message);
      return null;
    }
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
    try {
      await withDbTimeout(ensureSchema());
      await withDbTimeout(
        withClient((c) =>
          c.query(
            `INSERT INTO blob_store (key, mime, data, updated_at)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (key) DO UPDATE SET mime = EXCLUDED.mime, data = EXCLUDED.data, updated_at = NOW()`,
            [key, mime, data]
          )
        )
      );
    } catch (err: any) {
      console.error(`[storage] writeBlob("${key}") failed:`, err.message);
      throw err;
    }
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

