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
    // CAPACIDAD MÁXIMA: 25 conexiones simultáneas (antes 10) — cubre
    // sync masivo + dashboard + múltiples usuarios sin esperar.
    max: 25,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });
  // Handler de errores idle — evita matar el proceso por desconexiones.
  globalThis.__pgPool.on("error", (err) => {
    console.warn("[db pool] error idle client (ignorado):", err.message);
  });

  // PRE-CALENTAMIENTO: 8 SELECT 1 en paralelo → 8 conexiones warm.
  // El dashboard hace ~5 fetches paralelos + el inbox otros 3-4.
  // Con 8 warm, todo es instantáneo desde la primera petición.
  const WARM_COUNT = 8;
  Promise.all(
    Array(WARM_COUNT).fill(0).map(() => globalThis.__pgPool!.query("SELECT 1"))
  ).then(() => {
    console.log(`[db pool] ${WARM_COUNT} conexiones pre-calentadas — todo instantáneo`);
  }).catch((e) => {
    console.warn("[db pool] pre-calentamiento falló:", e?.message);
  });

  // KEEPALIVE: cada 20s mantiene 8 conexiones warm. Si alguna muere,
  // el handler de error la recicla y la próxima keepalive abre una nueva.
  if (!(globalThis as any).__pgKeepalive) {
    (globalThis as any).__pgKeepalive = setInterval(() => {
      const pool = globalThis.__pgPool;
      if (!pool) return;
      Promise.all(
        Array(WARM_COUNT).fill(0).map(() => pool.query("SELECT 1").catch(() => {}))
      ).catch(() => {});
    }, 20_000);
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
