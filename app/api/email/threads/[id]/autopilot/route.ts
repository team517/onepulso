import { NextRequest, NextResponse } from "next/server";
import { updateThread, getThread } from "@/lib/email-threads";
import { runAutopilot } from "@/lib/email-autopilot";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const enabled = body.enabled === true;
  const t = await getThread(id);
  if (!t) return NextResponse.json({ error: "thread no encontrado" }, { status: 404 });
  await updateThread(id, { auto_pilot: enabled });

  let auto: any = null;
  // Si se acaba de activar y hay un inbound sin respuesta, lanzar autopilot ya
  if (enabled) {
    const lastInbound = [...t.messages].reverse().find((m) => m.direction === "inbound");
    const lastMsg = t.messages[t.messages.length - 1];
    if (lastInbound && lastMsg?.id === lastInbound.id) {
      try {
        auto = await runAutopilot();
      } catch (e: any) {
        auto = { error: e.message };
      }
    }
  }
  return NextResponse.json({ ok: true, auto_pilot: enabled, auto });
}
