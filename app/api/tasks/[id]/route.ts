import { NextResponse } from "next/server";
import { updateTask, deleteTask } from "@/lib/tasks";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const task = await updateTask(id, body);
  if (!task) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return NextResponse.json({ task });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteTask(id);
  return NextResponse.json({ ok: true });
}
