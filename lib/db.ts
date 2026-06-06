import { Pool, PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pgInitDone: boolean | undefined;
}

/** Devuelve el pool de Postgres si DATABASE_URL está definido, si no null.
 *  Pre-calienta una conexión al crearlo + keepalive cada 25s para que
 *  la primera query del usuario sea INSTANTÁNEA (no espera TCP+TLS+auth). */
export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (globalThis.__pgPool) return globalThis.__pgPool;
  globalThis.__pgPool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal") ? false : { rejectUnauthorized: false },
    max: 100,
    min: 20,
    idleTimeoutMillis: 120_000,
    connectionTimeoutMillis: 30_000,
    statement_timeout: 45_000,
    query_timeout: 45_000,
  });
  // Handler de errores idle — evita matar el proceso por desconexiones.
  globalThis.__pgPool.on("error", (err) => {
    console.warn("[db pool] error idle client (ignorado):", err.message);
  });

  // PRE-CALENTAMIENTO: 20 SELECT 1 en paralelo → abre 20 conexiones que
  // quedan en el pool. Cuando el dashboard hace fetches paralelos,
  // reusan estas conexiones — todos instantáneos.
  Promise.all(
    Array.from({ length: 20 }, () => globalThis.__pgPool!.query("SELECT 1"))
  ).then(() => {
    console.log("[db pool] 20 conexiones pre-calentadas — peticiones paralelas instantáneas");
  }).catch((e) => {
    console.warn("[db pool] pre-calentamiento falló:", e?.message);
  });

  // KEEPALIVE: cada 10s (muy por debajo del idleTimeout de 120s) lanza 20
  // SELECT 1 en paralelo → mantiene 20 conexiones vivas (no se cierran por
  // idle). Si alguna conexión muere del lado Postgres, withClient + el
  // handler de error del pool la reciclan automáticamente.
  if (!(globalThis as any).__pgKeepalive) {
    (globalThis as any).__pgKeepalive = setInterval(() => {
      const pool = globalThis.__pgPool;
      if (!pool) return;
      // 20 queries en paralelo mantienen 20 slots warm
      Promise.all(
        Array.from({ length: 20 }, () => pool.query("SELECT 1").catch(() => {}))
      ).catch(() => {});
    }, 10_000);
  }

  // POOL MONITORING: cada 30s registra el estado del pool para debugging.
  if (!(globalThis as any).__pgMonitor) {
    (globalThis as any).__pgMonitor = setInterval(() => {
      const pool = globalThis.__pgPool;
      if (!pool) return;
      console.log(
        `[db pool] total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
      );
    }, 30_000);
  }

  return globalThis.__pgPool;
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
