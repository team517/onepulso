import { NextRequest, NextResponse } from "next/server";
import { getConversation, saveConversation, deleteConversation } from "@/lib/conversations";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const conv = await getConversation(id);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ conversation: conv });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const conv = await getConversation(id);
  if (!conv) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (Array.isArray(body.messages)) conv.messages = body.messages;
  if (typeof body.title === "string" && body.title.trim()) conv.title = body.title.trim();
  await saveConversation(conv);
  return NextResponse.json({ conversation: conv });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteConversation(id);
  return NextResponse.json({ ok: true });
}
