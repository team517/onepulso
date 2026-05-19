import { NextRequest, NextResponse } from "next/server";
import { updateStage, deleteStage } from "@/lib/onboarding";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const stage = await updateStage(id, body);
  if (!stage) return NextResponse.json({ error: "Stage no encontrado" }, { status: 404 });
  return NextResponse.json({ stage });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteStage(id);
  return NextResponse.json({ ok: true });
}
