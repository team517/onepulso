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

  // PRE-CALENTAMIENTO: 3 conexiones warm (bajado de 8 — cada conexión
  // idle consume RAM). 3 cubre el caso típico; las demás se abren on-demand.
  const WARM_COUNT = 3;
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

/** Detecta si un error de query es de conexión muerta (no de lógica/SQL). */
function isTransientConnError(e: any): boolean {
  if (!e) return false;
  const code = e.code || "";
  const msg = String(e.message || "").toLowerCase();
  return (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EPIPE" ||
    code === "ENOTFOUND" ||
    code === "57P01" || // admin_shutdown
    code === "57P02" || // crash_shutdown
    code === "57P03" || // cannot_connect_now
    code === "08000" || // connection_exception
    code === "08003" || // connection_does_not_exist
    code === "08006" || // connection_failure
    msg.includes("connection terminated") ||
    msg.includes("server closed the connection") ||
    msg.includes("client has been closed") ||
    msg.includes("connection ended") ||
    msg.includes("connection reset") ||
    msg.includes("read econnreset")
  );
}

/** Helper para ejecutar query con conexión auto-gestionada.
 *  RESILIENCIA: si la conexión está muerta (idle close por parte de Postgres,
 *  reset de red, etc.), descarta el cliente del pool y reintenta con uno nuevo.
 *  El usuario nunca ve "Connection terminated" — la query siempre se ejecuta. */
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL no configurado");

  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const result = await fn(client);
      client.release();
      return result;
    } catch (e: any) {
      lastError = e;
      // Si la conexión murió, descartarla del pool (release con error)
      // y reintentar con una nueva. Si es error de lógica/SQL, propagar.
      if (client) {
        try {
          client.release(isTransientConnError(e) ? e : undefined);
        } catch {}
      }
      if (!isTransientConnError(e)) throw e; // error real, no reintentar
      // Backoff corto: 100ms, 300ms
      if (attempt < 2) await new Promise((r) => setTimeout(r, 100 * (attempt + 1) * 3));
      console.warn(`[db] reintento ${attempt + 1}/2 tras conexión muerta: ${e?.message?.slice(0, 100)}`);
    }
  }
  throw lastError;
}

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}
