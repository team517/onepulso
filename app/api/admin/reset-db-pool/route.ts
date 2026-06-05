import { NextRequest, NextResponse } from "next/server";
import { withClient } from "@/lib/db";
import { requireAdmin } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/**
 * POST /api/admin/reset-db-pool
 * Endpoint simplificado — solo hace una test query. El pool ya no se
 * puede resetear desde código (volvimos al pool simple).
 */
export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
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
    test_query_ok: testOk,
    test_query_error: testError,
    test_query_ms: ms,
  });
}
