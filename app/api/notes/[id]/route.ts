import { NextResponse } from "next/server";
import { updateNote, deleteNote } from "@/lib/notes";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const note = await updateNote(id, body);
  if (!note) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  return NextResponse.json({ note });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteNote(id);
  return NextResponse.json({ ok: true });
}
