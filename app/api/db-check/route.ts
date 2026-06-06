import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/db-check
 * Public endpoint — no auth required (see middleware.ts).
 * Returns database connectivity status and connection pool metrics.
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  if (!process.env.DATABASE_URL) {
    return NextResponse.json(
      {
        status: "error",
        message: "DATABASE_URL is not configured",
        timestamp,
      },
      { status: 503 }
    );
  }

  const pool = getPool();
  if (!pool) {
    return NextResponse.json(
      {
        status: "error",
        message: "Database pool could not be initialised",
        timestamp,
      },
      { status: 503 }
    );
  }

  const t0 = Date.now();
  try {
    const result = await pool.query<{
      current_time: string;
      db_version: string;
    }>("SELECT NOW() AS current_time, version() AS db_version");

    const query_time_ms = Date.now() - t0;
    const row = result.rows[0];

    const tablesResult = await pool.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const tables = tablesResult.rows.map((r) => r.tablename);

    return NextResponse.json({
      status: "ok",
      message: "Database connection is healthy",
      timestamp,
      database: {
        current_time: row.current_time,
        db_version: row.db_version,
        query_time_ms,
        tables_count: tables.length,
        tables,
      },
      pool: {
        idle_count: pool.idleCount,
        waiting_count: pool.waitingCount,
        total_count: pool.totalCount,
      },
    });
  } catch (err: any) {
    const query_time_ms = Date.now() - t0;
    return NextResponse.json(
      {
        status: "error",
        message: err?.message || String(err),
        timestamp,
        pool: {
          idle_count: pool.idleCount,
          waiting_count: pool.waitingCount,
          total_count: pool.totalCount,
        },
        query_time_ms,
      },
      { status: 503 }
    );
  }
}
