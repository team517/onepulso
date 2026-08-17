import { withRequestTenant } from "@/lib/client-auth";
import { NextRequest, NextResponse } from "next/server";
import { getThread, updateThread, deleteThread } from "@/lib/email-threads";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(_req as any, async () => {
  const { id } = await ctx.params;
  const t = await getThread(id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  // NO auto-marcar watched aquí. El usuario decide explícitamente qué seguir.
  return NextResponse.json({ thread: t });

  }) as any;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(req as any, async () => {
  const { id } = await ctx.params;
  const body = await req.json();
  const t = await updateThread(id, body);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread: t });

  }) as any;
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(_req as any, async () => {
  const { id } = await ctx.params;
  await deleteThread(id);
  return NextResponse.json({ ok: true });

  }) as any;
}
