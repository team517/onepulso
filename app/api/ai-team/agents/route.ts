import { NextRequest, NextResponse } from "next/server";
import { listAgents, saveAgent, deleteAgent, ROLE_PRESETS } from "@/lib/ai-team";

export const runtime = "nodejs";

/** GET → { agents, roles } */
export async function GET() {
  const agents = await listAgents();
  return NextResponse.json({ agents, roles: ROLE_PRESETS });
}

/** POST → crea/actualiza un agente. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (!b?.name || !b?.role) return NextResponse.json({ error: "Faltan nombre y rol." }, { status: 400 });
  try {
    const agent = await saveAgent({
      id: b.id,
      name: String(b.name).trim(),
      role: String(b.role).trim(),
      emoji: b.emoji,
      provider: b.provider === "deepseek" ? "deepseek" : "claude",
      instructions: String(b.instructions || ""),
      memory: String(b.memory || ""),
      connections: Array.isArray(b.connections) ? b.connections.map(String) : undefined,
      x: typeof b.x === "number" ? b.x : undefined,
      y: typeof b.y === "number" ? b.y : undefined,
    });
    return NextResponse.json({ ok: true, agent });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

/** DELETE ?id= → borra un agente. */
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id." }, { status: 400 });
  await deleteAgent(id);
  return NextResponse.json({ ok: true });
}
