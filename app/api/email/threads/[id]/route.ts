import { NextRequest, NextResponse } from "next/server";
import { getThread, updateThread, deleteThread } from "@/lib/email-threads";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = await getThread(id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Auto-marcar como watched al abrir (user-initiated interaction)
  if (!t.watched) {
    await updateThread(id, { watched: true } as any);
    t.watched = true;
  }
  return NextResponse.json({ thread: t });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const t = await updateThread(id, body);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread: t });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteThread(id);
  return NextResponse.json({ ok: true });
}
