import { Pool, PoolClient } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __pgInitDone: boolean | undefined;
  // eslint-disable-next-line no-var
  var __pgKeepalive: ReturnType<typeof setInterval> | undefined;
  // eslint-disable-next-line no-var
  var __pgMonitor: ReturnType<typeof setInterval> | undefined;
}

/** Devuelve el pool de Postgres si DATABASE_URL está definido, si no null.
 *  Pre-calienta una conexión al crearlo + keepalive cada 20s para que
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

  // Handler de errores idle — limpia los intervalos para evitar que sigan
  // disparando contra un pool muerto y acumulando promesas en memoria.
  globalThis.__pgPool.on("error", (err) => {
    console.warn("[db pool] error idle client:", err.message);
    if (globalThis.__pgKeepalive) {
      clearInterval(globalThis.__pgKeepalive);
      globalThis.__pgKeepalive = undefined;
    }
    if (globalThis.__pgMonitor) {
      clearInterval(globalThis.__pgMonitor);
      globalThis.__pgMonitor = undefined;
    }
  });

  // PRE-CALENTAMIENTO: 8 SELECT 1 en paralelo → 8 conexiones warm.
  // El dashboard hace ~5 fetches paralelos + el inbox otros 3-4.
  // Con 8 warm, todo es instantáneo desde la primera petición.
  const WARM_COUNT = 8;
  // Timeout de seguridad: si una query de warmup cuelga más de 10s, la
  // descartamos para no bloquear el arranque ni acumular promesas.
  const queryWithTimeout = (pool: Pool, timeoutMs: number): Promise<void> => {
    return Promise.race([
      pool.query("SELECT 1").then(() => {}),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error("keepalive timeout")), timeoutMs)
      ),
    ]).catch(() => {});
  };

  Promise.all(
    Array(WARM_COUNT).fill(0).map(() => queryWithTimeout(globalThis.__pgPool!, 10_000))
  ).then(() => {
    console.log(`[db pool] ${WARM_COUNT} conexiones pre-calentadas — todo instantáneo`);
  }).catch(() => {
    console.warn("[db pool] pre-calentamiento falló");
  });

  // KEEPALIVE: cada 20s mantiene 8 conexiones warm. Si alguna muere,
  // el handler de error la recicla y la próxima keepalive abre una nueva.
  //
  // ANTI-LEAK: usamos un flag `running` para que si el ciclo anterior aún
  // no terminó (queries lentas / pool saturado) el nuevo ciclo se salte,
  // evitando la acumulación de promesas pendientes en memoria.
  if (!globalThis.__pgKeepalive) {
    let keepaliveRunning = false;
    globalThis.__pgKeepalive = setInterval(() => {
      const pool = globalThis.__pgPool;
      if (!pool || keepaliveRunning) return;
      keepaliveRunning = true;
      Promise.all(
        Array(WARM_COUNT).fill(0).map(() => queryWithTimeout(pool, 8_000))
      ).then(() => {
        keepaliveRunning = false;
      }).catch(() => {
        keepaliveRunning = false;
      });
    }, 20_000);
    // Permite que Node.js salga aunque el intervalo esté activo (no bloquea el proceso).
    if (globalThis.__pgKeepalive.unref) globalThis.__pgKeepalive.unref();
  }

  // MONITOREO: cada 30s registra el estado del pool para diagnóstico.
  // También usa un flag para no acumular logs si el ciclo anterior cuelga.
  if (!globalThis.__pgMonitor) {
    let monitorRunning = false;
    globalThis.__pgMonitor = setInterval(() => {
      const pool = globalThis.__pgPool;
      if (!pool || monitorRunning) return;
      monitorRunning = true;
      try {
        const { totalCount, idleCount, waitingCount } = pool;
        console.log(
          `[db pool] total=${totalCount} idle=${idleCount} waiting=${waitingCount} ` +
          `mem_heap_mb=${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}`
        );
      } finally {
        monitorRunning = false;
      }
    }, 30_000);
    if (globalThis.__pgMonitor.unref) globalThis.__pgMonitor.unref();
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
