import { NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    // Ejecutar los cambios de configuración
    await withClient(async (client) => {
      const queries = [
        "ALTER SYSTEM SET max_wal_size = '4GB'",
        "ALTER SYSTEM SET shared_buffers = '256MB'",
        "ALTER SYSTEM SET effective_cache_size = '1GB'",
        "ALTER SYSTEM SET work_mem = '16MB'",
        "ALTER SYSTEM SET maintenance_work_mem = '128MB'",
        "ALTER SYSTEM SET checkpoint_timeout = '15min'",
        "ALTER SYSTEM SET checkpoint_completion_target = 0.9",
      ];

      for (const query of queries) {
        await client.query(query);
        console.log(`[postgres-optimize] Executed: ${query}`);
      }

      // Recargar la configuración
      await client.query("SELECT pg_reload_conf()");
      console.log("[postgres-optimize] Configuration reloaded");
    });

    return NextResponse.json({
      success: true,
      message: "Postgres configuration optimized. Changes will take effect after restart.",
    });
  } catch (err: any) {
    console.error("[postgres-optimize] Error:", err.message);
    return NextResponse.json(
      { error: err.message },
      { status: 500 }
    );
  }
}

