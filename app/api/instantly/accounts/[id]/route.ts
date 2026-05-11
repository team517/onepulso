import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, setActive, renameAccount } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

/** PATCH — { active?: true, title?: string } */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body.active === true) {
    await setActive(id);
  }
  if (typeof body.title === "string" && body.title.trim()) {
    await renameAccount(id, body.title);
  }
  return NextResponse.json({ ok: true });
}

/** DELETE — borra la cuenta */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteAccount(id);
  return NextResponse.json({ ok: true });
}
