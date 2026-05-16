import { NextResponse } from "next/server";
import { updateExpense, deleteExpense } from "@/lib/expenses";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const expense = await updateExpense(id, body);
  if (!expense) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return NextResponse.json({ expense });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteExpense(id);
  return NextResponse.json({ ok: true });
}
