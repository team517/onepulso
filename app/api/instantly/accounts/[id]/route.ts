import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, setActive, setOwner, updateAccountMeta } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body.active === true) {
    await setActive(id);
  }
  if (body.is_owner === true) {
    await setOwner(id);
  }
  // Editar metadata
  if ("title" in body || "renews_at" in body || "plan_label" in body || "client_company" in body || "client_contact" in body) {
    await updateAccountMeta(id, {
      title: body.title,
      renews_at: body.renews_at === "" ? null : body.renews_at,
      plan_label: body.plan_label === "" ? null : body.plan_label,
      client_company: body.client_company === "" ? null : body.client_company,
      client_contact: body.client_contact === "" ? null : body.client_contact,
    });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    await deleteAccount(id);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
