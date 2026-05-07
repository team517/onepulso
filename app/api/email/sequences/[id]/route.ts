import { NextRequest, NextResponse } from "next/server";
import { getSequence, deleteSequence } from "@/lib/email-sequences";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const s = await getSequence(id);
  if (!s) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ sequence: s });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteSequence(id);
  return NextResponse.json({ ok: true });
}
