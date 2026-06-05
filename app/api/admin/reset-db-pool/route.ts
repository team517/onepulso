import { NextRequest, NextResponse } from "next/server";
import { resetPool, withClient } from "@/lib/db";
import { requireAdmin } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/**
 * POST /api/admin/reset-db-pool
 * Cierra el pool de Postgres actual y fuerza recreación. Útil cuando
 * el pool quedó zombi tras migración de Postgres o restart de Railway.
 * También se llama solo cuando hay 5 errores de conexión seguidos.
 */
export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  await resetPool();
  // Test inmediato del pool nuevo
  let testOk = false;
  let testError: string | null = null;
  const t0 = Date.now();
  try {
    await withClient(async (c) => {
      await c.query("SELECT 1");
    });
    testOk = true;
  } catch (e: any) {
    testError = e?.message || String(e);
  }
  const ms = Date.now() - t0;
  return NextResponse.json({
    ok: true,
    pool_reset: true,
    test_query_ok: testOk,
    test_query_error: testError,
    test_query_ms: ms,
  });
}
