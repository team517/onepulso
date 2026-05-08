import { NextRequest, NextResponse } from "next/server";
import { updateThread, getThread } from "@/lib/email-threads";
import { runAutopilot } from "@/lib/email-autopilot";

export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * POST /api/email/threads/:id/autopilot
 * Body: {
 *   enabled?: boolean,
 *   contact_name?: string,
 *   contact_context?: string,
 *   tone?: string,
 *   objective?: string,
 *   custom_prompt?: string,
 *   acknowledge_contract?: boolean,  // marcar la alerta de contrato como vista
 * }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();

  const t = await getThread(id);
  if (!t) return NextResponse.json({ error: "thread no encontrado" }, { status: 404 });

  const patch: any = {};
  if (typeof body.enabled === "boolean") patch.auto_pilot = body.enabled;
  if (typeof body.contact_name === "string")    patch.contact_name = body.contact_name;
  if (typeof body.contact_context === "string") patch.contact_context = body.contact_context;
  if (typeof body.tone === "string")            patch.tone = body.tone;
  if (typeof body.objective === "string")       patch.objective = body.objective;
  if (typeof body.custom_prompt === "string")   patch.custom_prompt = body.custom_prompt;

  if (body.acknowledge_contract === true && t.contract_alert) {
    patch.contract_alert = { ...t.contract_alert, acknowledged: true };
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  await updateThread(id, patch);

  let auto: any = null;
  // Si se acaba de activar y hay un inbound sin respuesta, lanzar autopilot ya
  if (patch.auto_pilot === true) {
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

  return NextResponse.json({
    ok: true,
    auto_pilot:       patch.auto_pilot       ?? t.auto_pilot       ?? false,
    contact_name:     patch.contact_name     ?? t.contact_name     ?? null,
    contact_context:  patch.contact_context  ?? t.contact_context  ?? null,
    tone:             patch.tone             ?? t.tone             ?? null,
    objective:        patch.objective        ?? t.objective        ?? null,
    custom_prompt:    patch.custom_prompt    ?? t.custom_prompt    ?? null,
    auto,
  });
}
