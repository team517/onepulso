import { Pool, PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pgInitDone: boolean | undefined;
}

/** Devuelve el pool de Postgres si DATABASE_URL está definido, si no null.
 *  Config optimizada para CONEXIONES PERSISTENTES — no abrir/cerrar todo
 *  el rato:
 *  - max: 20 conexiones simultáneas (cubre 15 syncs paralelos + user)
 *  - min: 5 conexiones siempre activas (no se cierran nunca)
 *  - idleTimeoutMillis: 0 (NUNCA cerrar por inactividad)
 *  - keepAlive: true (TCP keepalive — mantiene la conexión viva en routers/firewalls)
 *  - allowExitOnIdle: false (las conexiones idle no bloquean exit pero no se cierran solas)
 */
export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (globalThis.__pgPool) return globalThis.__pgPool;
  globalThis.__pgPool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal") ? false : { rejectUnauthorized: false },
    // CONEXIONES PERSISTENTES
    max: 20,
    min: 5, // 5 conexiones siempre vivas
    idleTimeoutMillis: 0, // NUNCA cerrar por idle
    connectionTimeoutMillis: 15_000,
    keepAlive: true, // TCP keepalive a nivel SO
    keepAliveInitialDelayMillis: 10_000, // empieza keepalive a los 10s
    allowExitOnIdle: false,
  });
  // Handler de errores idle — evita matar el proceso por desconexiones.
  globalThis.__pgPool.on("error", (err) => {
    console.warn("[db pool] error idle client (ignorado):", err.message);
  });
  // Pre-calentar las conexiones min al arrancar — abre las 5 conexiones YA.
  (async () => {
    const pool = globalThis.__pgPool!;
    try {
      const clients = await Promise.all([
        pool.connect(), pool.connect(), pool.connect(), pool.connect(), pool.connect(),
      ]);
      // Soltarlas vuelven al pool listas. NO se cerrarán porque idleTimeoutMillis: 0.
      for (const c of clients) c.release();
      console.log("[db pool] 5 conexiones pre-calentadas y persistentes");
    } catch (e: any) {
      console.warn("[db pool] no se pudieron pre-calentar conexiones:", e?.message);
    }
  })();
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
