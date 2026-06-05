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
    max: 20,
    min: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    // NO statement_timeout/query_timeout aquí — mataba CREATE INDEX
    // y otras DDL legítimas tras migraciones. Para queries normales
    // usamos timeout en el código (withClient ya tiene retry).
  });
  return globalThis.__pgPool;
}

/** Inicializa el schema (tablas KV y blobs) si no existe.
 *  OPTIMIZACIÓN CRÍTICA: primero CHECK existencia con SELECT rápido (~5ms).
 *  Solo intenta CREATE si las tablas NO existen. Esto evita el problema
 *  de CREATE TABLE/INDEX timeouteando en cada conexión nueva tras una
 *  migración Postgres con índices lentos. */
export async function ensureSchema(): Promise<void> {
  if (globalThis.__pgInitDone) return;
  const pool = getPool();
  if (!pool) return;
  // Marcar done ANTES → si todo timeoutea, no entramos en bucle infinito
  globalThis.__pgInitDone = true;
  let client;
  try {
    client = await pool.connect();
  } catch (e: any) {
    console.warn("[db] ensureSchema: no se pudo conectar:", e.message);
    return; // la próxima query mostrará el error real
  }
  try {
    // FAST CHECK: ¿existen las tablas ya? (la mayoría de las veces sí)
    const check = await client.query(
      "SELECT to_regclass('public.kv_store') AS kv, to_regclass('public.blob_store') AS blob"
    ).catch(() => null);
    const kvExists = check?.rows?.[0]?.kv !== null;
    const blobExists = check?.rows?.[0]?.blob !== null;

    if (kvExists && blobExists) {
      // Caso normal: tablas ya existen → no hacer nada más.
      console.log("[db] schema OK (tablas existentes)");
      return;
    }

    // Solo si falta algo, intentamos crear (puede tardar mucho en DB recién
    // migrada — pero solo pasa una vez por proceso).
    console.log(`[db] creando schema faltante (kv=${kvExists}, blob=${blobExists})`);
    if (!kvExists) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS kv_store (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch((e) => console.warn("[db] CREATE kv_store:", e.message));
    }
    if (!blobExists) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS blob_store (
          key TEXT PRIMARY KEY,
          mime TEXT NOT NULL DEFAULT 'application/octet-stream',
          data BYTEA NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch((e) => console.warn("[db] CREATE blob_store:", e.message));
    }
    // Index: opcional. Si falla, queries van más lentas pero funcionan.
    client.query(
      `CREATE INDEX IF NOT EXISTS kv_store_key_prefix_idx ON kv_store (key text_pattern_ops)`
    ).catch((e) => console.warn("[db] CREATE INDEX (no bloqueante):", e.message));
  } finally {
    try { client.release(); } catch {}
  }
}

/** Recrea el pool de Postgres — útil cuando las conexiones quedan zombi
 *  tras una migración de región o un restart de Postgres. */
export async function resetPool(): Promise<void> {
  if (globalThis.__pgPool) {
    try { await globalThis.__pgPool.end(); } catch {}
  }
  globalThis.__pgPool = undefined;
  globalThis.__pgInitDone = undefined;
  console.warn("[db] pool reseteado — próxima query reconectará desde cero");
}

let _consecutiveErrors = 0;

/** Helper para ejecutar query con conexión auto-gestionada.
 *  RESILIENCIA:
 *  - Hasta 3 reintentos con backoff exponencial para errores transientes
 *  - Si hay 5 errores seguidos, RESETEA el pool entero (recovery de
 *    pool con conexiones zombi tras migración Postgres) */
export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL no configurado");
  let lastError: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 200 * (3 ** attempt - 1)));
      console.warn(`[db] reintento ${attempt}/2 tras error: ${lastError?.message}`);
    }
    let client: PoolClient | null = null;
    try {
      client = await pool.connect();
      const result = await fn(client);
      client.release();
      _consecutiveErrors = 0; // success → reset contador
      return result;
    } catch (e: any) {
      lastError = e;
      if (client) {
        try { client.release(true); } catch {}
      }
      const isTransient =
        e?.code === "ECONNREFUSED" ||
        e?.code === "ETIMEDOUT" ||
        e?.code === "ENOTFOUND" ||
        e?.code === "EPIPE" ||
        e?.code === "ECONNRESET" ||
        /Connection terminated|Connection refused|server closed|timeout/i.test(e?.message || "");
      if (!isTransient) throw e;
      _consecutiveErrors++;
      // 5 errores seguidos = pool corrupto → resetear
      if (_consecutiveErrors >= 5) {
        console.error(`[db] ${_consecutiveErrors} errores seguidos → RESET del pool`);
        await resetPool();
        _consecutiveErrors = 0;
        // Reintentamos con pool nuevo
        const newPool = getPool();
        if (newPool) {
          let c2: PoolClient | null = null;
          try {
            c2 = await newPool.connect();
            const r = await fn(c2);
            c2.release();
            return r;
          } catch (e2) {
            if (c2) { try { c2.release(true); } catch {} }
            throw e2;
          }
        }
      }
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
