import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, setActive, updateAccountMeta } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body.active === true) {
    await setActive(id);
  }
  // Editar metadata: title, renews_at (string ISO o null para borrar), plan_label
  if ("title" in body || "renews_at" in body || "plan_label" in body) {
    await updateAccountMeta(id, {
      title: body.title,
      renews_at: body.renews_at === "" ? null : body.renews_at,
      plan_label: body.plan_label === "" ? null : body.plan_label,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteAccount(id);
  return NextResponse.json({ ok: true });
}
