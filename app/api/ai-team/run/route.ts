import { NextRequest, NextResponse } from "next/server";
import { runTeam } from "@/lib/ai-team";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST { agentId, message, clientId? } → orquesta al agente y su equipo. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const agentId = String(b?.agentId || "");
  const message = String(b?.message || "").trim();
  const clientId = b?.clientId ? String(b.clientId) : undefined;
  if (!agentId || !message) return NextResponse.json({ error: "Falta agente o mensaje." }, { status: 400 });
  try {
    const r = await runTeam({ agentId, message, clientId });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
