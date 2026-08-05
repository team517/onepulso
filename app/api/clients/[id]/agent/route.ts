import { NextRequest, NextResponse } from "next/server";
import { runClientAgent } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST { message, mode } → asistente IA del cliente con sus datos reales. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await req.json().catch(() => ({}));
  const message = String(b?.message || "").trim();
  const mode = b?.mode === "atencion" ? "atencion" : "prompt";
  if (!message) return NextResponse.json({ error: "Escribe algo." }, { status: 400 });
  try {
    const r = await runClientAgent(id, message, mode);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
