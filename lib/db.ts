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
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
  });
  // Limpiar conexiones zombi de procesos antiguos al arrancar.
  // Esto resuelve "too many clients already" tras múltiples deploys.
  const pool = globalThis.__pgPool;
  pool.connect().then(async (c) => {
    try {
      await c.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE state IN ('idle', 'idle in transaction')
           AND pid <> pg_backend_pid()
           AND backend_type = 'client backend'
           AND state_change < NOW() - INTERVAL '30 seconds'`
      );
      console.log("[db] conexiones zombi limpiadas en arranque");
    } catch (e: any) {
      console.warn("[db] no se pudieron limpiar zombi:", e?.message);
    } finally {
      c.release();
    }
  }).catch((e) => {
    console.warn("[db] cleanup zombi falló:", e?.message);
  });
  return pool;
}

/** Inicializa el schema (tablas KV y blobs) si no existe. Idempotente. */
export async function ensureSchema(): Promise<void> {
  if (globalThis.__pgInitDone) return;
  const pool = getPool();
  if (!pool) return;
  const client = await pool.connect();
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

/** Helper para ejecutar query con conexión auto-gestionada */
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL no configurado");
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}
