import { NextResponse } from "next/server";
import { getPool, ensureSchema, isDbEnabled, withClient, resolveDatabaseUrl } from "@/lib/db";

export const runtime = "nodejs";

// Cache 30s del resultado — esto evita que el aviso amarillo
// reaparezca por queries lentas mientras el blob email-threads
// es grande. Si la BD realmente se desconecta, en 30s lo detectamos.
let _cached: { ts: number; data: any } | null = null;
const CACHE_MS = 30_000;

/** GET /api/debug/storage — diagnóstico LIGERO del storage en prod */
export async function GET() {
  if (_cached && Date.now() - _cached.ts < CACHE_MS) {
    return NextResponse.json({ ..._cached.data, cached: true }, { status: 200 });
  }

  const resolvedUrl = resolveDatabaseUrl();
  const report: any = {
    // has_database_url ahora refleja si EXISTE alguna conexión válida (con
    // cualquier nombre de variable), no solo la DATABASE_URL exacta.
    has_database_url: !!resolvedUrl,
    db_url_host: resolvedUrl
      ? (() => { try { return new URL(resolvedUrl.replace(/^postgres(ql)?:\/\//, "https://")).hostname; } catch { return "?"; } })()
      : null,
    is_db_enabled: isDbEnabled(),
    data_dir: process.env.DATA_DIR || "(no DATA_DIR set)",
  };

  if (isDbEnabled()) {
    try {
      await ensureSchema();
      const pool = getPool();
      if (pool) {
        // SOLO COUNT — antes hacíamos octet_length(value::text) sobre TODOS
        // los registros, incluyendo email-threads (multi-MB). Eso tarda
        // 5-15s en BBDD recién migradas → timeout → false positive del
        // aviso amarillo "datos no se están guardando".
        // Ahora: 2 counts rápidos (~20ms cada uno).
        const counts = await withClient(async (c) => {
          const kv = await c.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM kv_store");
          const blob = await c.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM blob_store");
          return {
            kv_rows: kv.rows[0]?.count ?? "0",
            blob_rows: blob.rows[0]?.count ?? "0",
          };
        });
        report.postgres = { connected: true, ...counts };
      }
    } catch (e: any) {
      report.postgres = { connected: false, error: e.message };
    }
  }

  _cached = { ts: Date.now(), data: report };
  return NextResponse.json(report, { status: 200 });
}

/** GET /api/debug/storage?detail=1 — versión completa (lenta) con sizes */
export async function POST() {
  const report: any = {
    has_database_url: !!process.env.DATABASE_URL,
  };
  if (isDbEnabled()) {
    try {
      await ensureSchema();
      const pool = getPool();
      if (pool) {
        const detail = await withClient(async (c) => {
          const kv = await c.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM kv_store");
          const blob = await c.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM blob_store");
          // Solo top 30 más grandes — limitado para no timeoutear
          const keys = await c.query<{ key: string; size: string }>(
            "SELECT key, (octet_length(value::text)/1024)::text AS size FROM kv_store ORDER BY octet_length(value::text) DESC LIMIT 30"
          );
          return {
            kv_rows: kv.rows[0]?.count ?? "0",
            blob_rows: blob.rows[0]?.count ?? "0",
            top_30_by_size: keys.rows.map((r) => ({ key: r.key, size_kb: r.size })),
          };
        });
        report.postgres = { connected: true, ...detail };
      }
    } catch (e: any) {
      report.postgres = { connected: false, error: e.message };
    }
  }
  return NextResponse.json(report, { status: 200 });
}
