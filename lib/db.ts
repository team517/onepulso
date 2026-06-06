import { Pool, PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pgInitDone: boolean | undefined;
}

/** Devuelve el pool de Postgres si DATABASE_URL está definido, si no null. */
export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (globalThis.__pgPool) return globalThis.__pgPool;
  globalThis.__pgPool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal") ? false : { rejectUnauthorized: false },
    max: 10,
    min: 1,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  // Manejador de errores del pool: evita que un error de conexión
  // cualquiera mate el proceso entero (lo veíamos como
  // "uncaughtException: Connection terminated unexpectedly").
  globalThis.__pgPool.on("error", (err) => {
    console.warn("[db pool] error idle client — forzando recreación del pool:", err.message);
    // Marcar el pool como corrupto para que la próxima llamada a getPool()
    // cree uno nuevo en lugar de reutilizar el pool roto.
    globalThis.__pgPool = undefined;
    globalThis.__pgInitDone = undefined;
  });
  return globalThis.__pgPool;
}

/**
 * Intenta obtener un cliente del pool con reintentos y backoff exponencial.
 * Útil cuando Postgres acaba de recuperarse y el pool aún no está listo.
 *
 * @param maxAttempts  Número máximo de intentos (default: 3)
 * @param baseDelayMs  Delay inicial en ms antes del primer reintento (default: 500)
 */
async function connectWithRetry(
  pool: Pool,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<PoolClient> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await pool.connect();
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        /timeout|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connection terminated|connection refused/i.test(
          err?.message || ""
        );
      if (!isRetryable || attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1); // 500ms, 1000ms, …
      console.warn(
        `[db pool] intento ${attempt}/${maxAttempts} fallido (${err.message}) — reintentando en ${delay}ms`
      );
      await new Promise((res) => setTimeout(res, delay));
      // Si el pool fue marcado como corrupto durante el backoff, recrearlo
      if (!globalThis.__pgPool) {
        console.warn("[db pool] pool destruido durante backoff — recreando");
        getPool();
        if (!globalThis.__pgPool) throw lastError;
        // Usar el pool recién creado para el siguiente intento
        pool = globalThis.__pgPool;
      }
    }
  }
  throw lastError;
}

/** Inicializa el schema (tablas KV y blobs) si no existe. Idempotente. */
export async function ensureSchema(): Promise<void> {
  if (globalThis.__pgInitDone) return;
  const pool = getPool();
  if (!pool) return;
  const client = await connectWithRetry(pool);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS kv_store (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS kv_store_key_prefix_idx ON kv_store (key text_pattern_ops);

      CREATE TABLE IF NOT EXISTS blob_store (
        key TEXT PRIMARY KEY,
        mime TEXT NOT NULL DEFAULT 'application/octet-stream',
        data BYTEA NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    globalThis.__pgInitDone = true;
  } finally {
    client.release();
  }
}

/** Helper para ejecutar query con conexión auto-gestionada y reintentos */
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL no configurado");
  const client = await connectWithRetry(pool);
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

