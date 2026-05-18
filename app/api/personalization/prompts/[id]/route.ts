import { NextResponse } from "next/server";
import { updateSavedPrompt, deleteSavedPrompt, markPromptUsed } from "@/lib/saved-prompts";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  if (body.action === "mark_used") {
    await markPromptUsed(id);
    return NextResponse.json({ ok: true });
  }
  const p = await updateSavedPrompt(id, body);
  if (!p) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return NextResponse.json({ prompt: p });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteSavedPrompt(id);
  return NextResponse.json({ ok: true });
}
