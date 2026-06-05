import { NextRequest, NextResponse } from "next/server";
import { compactThreads } from "@/lib/email-threads";
import { requireAdmin } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/admin/compact-threads
 * Body opcional: { olderThanDays?: number }  (default 30)
 *
 * Mueve threads inactivos > X días + sin follow-up pendiente
 * de email-threads (blob principal leído cada 30s) a
 * email-threads/archive (solo lectura bajo demanda).
 *
 * IMPACTO: el scheduler tick pasa de leer N MB cada 30s
 * a leer SOLO los threads activos = 10-100x más rápido.
 */
export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const olderThanDays = typeof body?.olderThanDays === "number" ? body.olderThanDays : 30;

  const t0 = Date.now();
  const r = await compactThreads({ olderThanDays });
  const ms = Date.now() - t0;
  console.log(`[compact-threads] activos=${r.keptActive} archivados-ahora=${r.archivedNow} archivo-total=${r.totalArchived} (${ms}ms)`);
  return NextResponse.json({ ok: true, ...r, took_ms: ms });
}
