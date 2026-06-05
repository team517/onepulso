import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/**
 * GET /api/admin/perf-stats
 * Diagnóstico básico — uso de memoria + env vars.
 */
export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json({
    node_uptime_sec: Math.round(process.uptime()),
    node_memory: {
      rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
    env: {
      has_database_url: !!process.env.DATABASE_URL,
      database_url_internal: process.env.DATABASE_URL?.includes("railway.internal") || false,
      database_url_public_proxy: /proxy\.rlwy\.net/i.test(process.env.DATABASE_URL || ""),
      node_env: process.env.NODE_ENV,
      emergency_mode: process.env.EMERGENCY_MODE === "1",
    },
  });
}
