import { NextRequest, NextResponse } from "next/server";
import { startEmailScheduler, tick } from "@/lib/email-scheduler";
import { resolveDatabaseUrl, withClient } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Chequeo rápido y PÚBLICO del estado de la base de datos (sin datos, solo
 *  si conecta y a qué host). Útil para verificar la conexión sin login. */
async function dbStatus() {
  const url = resolveDatabaseUrl();
  let host: string | null = null;
  if (url) { try { host = new URL(url.replace(/^postgres(ql)?:\/\//, "https://")).hostname; } catch {} }
  if (!url) return { has_database_url: false, connected: false, host: null };
  try {
    await withClient((c) => c.query("SELECT 1"));
    return { has_database_url: true, connected: true, host };
  } catch (e: any) {
    return { has_database_url: true, connected: false, host, error: (e?.message || String(e)).slice(0, 160) };
  }
}

/**
 * GET /api/cron/tick
 * Endpoint público (sin auth). Sirve para:
 *  1. Re-arrancar el scheduler si por algún motivo se cayó (singleton check)
 *  2. Forzar un tick INMEDIATO: envía follow-ups vencidos + sincroniza inbox
 *
 * Puedes pingearlo desde:
 *  - Un cron de Railway / GitHub Actions / Uptime Robot cada 1-5 min
 *  - Manualmente desde el navegador
 *  - El propio frontend (de hecho lo hacemos automáticamente)
 */
export async function GET(req: NextRequest) {
  // Asegurar que el scheduler está corriendo (idempotente)
  startEmailScheduler();

  // ?db=1 → incluir estado de la base de datos (para verificar la conexión).
  const wantDb = new URL(req.url).searchParams.get("db") === "1";
  const db = wantDb ? await dbStatus() : undefined;

  // Disparar el tick en BACKGROUND — NO bloquear la respuesta. El tick
  // puede hacer trabajo pesado (sync de uniboxes cada 5 min) que tardaba
  // 30s+ y colgaba este endpoint (que el frontend pinguea como keepalive).
  // Respondemos al instante; el tick corre por detrás.
  setImmediate(() => {
    tick().catch((e) => console.warn("[cron/tick] background tick error:", e?.message || e));
  });

  // Exponer uso de RAM del proceso para monitoreo (público, solo números).
  const mem = process.memoryUsage();
  return NextResponse.json({
    ok: true,
    ticked_at: new Date().toISOString(),
    scheduled: true,
    rss_mb: Math.round(mem.rss / 1024 / 1024),
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
    uptime_min: Math.round(process.uptime() / 60),
    ...(db ? { db } : {}),
  });
}
