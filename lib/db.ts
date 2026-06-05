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

  // PERFORMANCE WARNING: si la URL es pública (proxy.rlwy.net), gastamos
  // 10-50x más latencia + se cobra egress. Avisamos en logs para que
  // el operador lo cambie a la URL interna .railway.internal.
  if (/proxy\.rlwy\.net|\.proxy\.rlwy\.net/i.test(url)) {
    console.error(
      "⚠️  ⚠️  ⚠️  PERFORMANCE WARNING ⚠️  ⚠️  ⚠️\n" +
      "DATABASE_URL apunta a la URL PÚBLICA de Postgres (proxy.rlwy.net).\n" +
      "Esto causa: 1) latencia 10-50x mayor por query, 2) egress fees.\n" +
      "SOLUCIÓN: En Railway → Next.js service → Variables → cambia DATABASE_URL\n" +
      "para que apunte a la URL interna (.railway.internal) del servicio Postgres.\n" +
      "Usa 'Variable Reference' → Postgres → DATABASE_URL.\n" +
      "──────────────────────────────────────────────────────────"
    );
  } else if (url.includes(".railway.internal")) {
    console.log("[db] ✓ usando URL interna de Postgres (.railway.internal) — óptimo");
  }

  globalThis.__pgPool = new Pool({
    connectionString: url,
    ssl: url.includes("railway.internal") ? false : { rejectUnauthorized: false },
    // PERFORMANCE: pool grande para no esperar nunca a connect() en cargas
    // burst (40 cuentas sincronizando en paralelo). 5 era cuello de botella.
    max: 20,
    min: 2, // pre-warm 2 conexiones siempre listas → primera query sin handshake
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Statement timeout: evita queries colgadas que bloqueen conexiones
    statement_timeout: 15_000,
    query_timeout: 15_000,
  });
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

/** Helper para ejecutar query con conexión auto-gestionada.
 *  RESILIENCIA: si la conexión falla (Postgres se cae o se está migrando),
 *  reintentamos hasta 3 veces con backoff exponencial. Crítico para que
 *  durante migraciones / restarts de Railway la app no devuelva 500. */
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL no configurado");
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      // Backoff: 200ms, 600ms
      await new Promise((r) => setTimeout(r, 200 * (3 ** attempt - 1)));
      console.warn(`[db] reintento ${attempt}/2 tras error: ${lastError?.message}`);
    }
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const result = await fn(client);
      client.release();
      return result;
    } catch (e: any) {
      lastError = e;
      if (client) {
        try { client.release(true); } catch {} // release con error → descarta del pool
      }
      // Solo reintentamos errores de conexión, no errores de lógica
      const isTransient =
        e?.code === "ECONNREFUSED" ||
        e?.code === "ETIMEDOUT" ||
        e?.code === "ENOTFOUND" ||
        e?.code === "EPIPE" ||
        e?.code === "ECONNRESET" ||
        /Connection terminated|Connection refused|server closed/i.test(e?.message || "");
      if (!isTransient) throw e;
    }
  }
  throw lastError;
}

/** Versión sin retry para usos donde ya estamos en un loop o no queremos reintentos. */
export async function withClientNoRetry<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
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
