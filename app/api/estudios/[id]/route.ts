import { NextRequest, NextResponse } from "next/server";
import { getEstudio, updateEstudio, deleteEstudio } from "@/lib/estudios";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const e = await getEstudio(id);
  if (!e) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ estudio: e });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const e = await updateEstudio(id, body);
  if (!e) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ estudio: e });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteEstudio(id);
  return NextResponse.json({ ok: true });
}
