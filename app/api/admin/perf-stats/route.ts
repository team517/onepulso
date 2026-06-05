import { NextRequest, NextResponse } from "next/server";
import { getStorageStats } from "@/lib/storage";
import { requireAdmin } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/**
 * GET /api/admin/perf-stats
 * Diagnóstico de rendimiento — devuelve cache hits/misses + queries lentas.
 * Solo admin.
 */
export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const stats = getStorageStats();
  return NextResponse.json({
    ...stats,
    hit_rate_percent: Math.round(stats.hit_rate * 100),
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
      region: process.env.RAILWAY_REGION || "unknown",
    },
    warnings: [
      ...(/proxy\.rlwy\.net/i.test(process.env.DATABASE_URL || "")
        ? ["DATABASE_URL apunta a la URL PÚBLICA — cambia a .railway.internal en Railway → Variables → DATABASE_URL"]
        : []),
      ...(process.env.NODE_ENV !== "production"
        ? ["NODE_ENV no es 'production' — el build no está optimizado"]
        : []),
    ],
  });
}
