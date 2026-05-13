import { NextResponse } from "next/server";
import { deepRefreshAllThreads } from "@/lib/email-inbox";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/email/deep-refresh
 * Lanza el deep refresh AHORA — escanea Gmail para todos los hilos abiertos y
 * trae cualquier mensaje nuevo (en cualquier dirección).
 * Body opcional: { days?: number, maxThreads?: number }
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const days = parseInt(body.days || "60", 10);
  const maxThreads = parseInt(body.maxThreads || "100", 10);

  try {
    const r = await deepRefreshAllThreads({ days, maxThreads });
    return NextResponse.json({
      ok: true,
      ...r,
      ran_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

// GET por conveniencia (mismo comportamiento, para que se pueda pingear desde browser)
export async function GET() {
  try {
    const r = await deepRefreshAllThreads({ days: 60, maxThreads: 100 });
    return NextResponse.json({
      ok: true,
      ...r,
      ran_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
