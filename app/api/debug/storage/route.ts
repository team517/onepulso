import { NextResponse } from "next/server";
import { getPool, ensureSchema, isDbEnabled, withClient } from "@/lib/db";

export const runtime = "nodejs";

/** GET /api/debug/storage — diagnóstico del storage en producción */
export async function GET() {
  const report: any = {
    has_database_url: !!process.env.DATABASE_URL,
    db_url_host: process.env.DATABASE_URL
      ? new URL(process.env.DATABASE_URL.replace("postgresql://", "https://").replace("postgres://", "https://")).hostname
      : null,
    is_db_enabled: isDbEnabled(),
    data_dir: process.env.DATA_DIR || "(no DATA_DIR set)",
  };

  if (isDbEnabled()) {
    try {
      await ensureSchema();
      const pool = getPool();
      if (pool) {
        const counts = await withClient(async (c) => {
          const kv = await c.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM kv_store");
          const blob = await c.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM blob_store");
          const keys = await c.query<{ key: string; size: string }>(
            "SELECT key, (octet_length(value::text)/1024)::text AS size FROM kv_store ORDER BY key"
          );
          return {
            kv_rows: kv.rows[0]?.count ?? "0",
            blob_rows: blob.rows[0]?.count ?? "0",
            keys: keys.rows.map((r) => ({ key: r.key, size_kb: r.size })),
          };
        });
        report.postgres = { connected: true, ...counts };
      }
    } catch (e: any) {
      report.postgres = { connected: false, error: e.message };
    }
  }

  return NextResponse.json(report, { status: 200 });
}
