import { NextResponse } from "next/server";
import { getJob, deleteJob } from "@/lib/personalization";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const j = await getJob(id);
  if (!j) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return NextResponse.json({ job: j });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteJob(id);
  return NextResponse.json({ ok: true });
}
