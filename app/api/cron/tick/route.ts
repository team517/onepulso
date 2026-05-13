import { NextResponse } from "next/server";
import { startEmailScheduler, tick } from "@/lib/email-scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

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
export async function GET() {
  // Asegurar que el scheduler está corriendo (idempotente)
  startEmailScheduler();

  // Forzar tick AHORA
  try {
    const r = await tick();
    return NextResponse.json({
      ok: true,
      ticked_at: new Date().toISOString(),
      sent: r?.sent ?? 0,
      failed: r?.failed ?? 0,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
