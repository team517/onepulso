import { NextRequest, NextResponse } from "next/server";
import { updateFollowup, deleteFollowup, listThreads } from "@/lib/email-threads";

export const runtime = "nodejs";

async function findThreadByFollowupId(followupId: string) {
  const all = await listThreads();
  for (const t of all) {
    if (t.followups.some((f) => f.id === followupId)) return t;
  }
  return null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const t = await findThreadByFollowupId(id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  const updated = await updateFollowup(t.id, id, body);
  return NextResponse.json({ followup: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = await findThreadByFollowupId(id);
  if (!t) return NextResponse.json({ error: "not found" }, { status: 404 });
  await deleteFollowup(t.id, id);
  return NextResponse.json({ ok: true });
}
