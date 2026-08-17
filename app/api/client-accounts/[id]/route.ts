import { NextRequest, NextResponse } from "next/server";
import { isOwner } from "@/lib/client-auth";
import { setClientActive, setClientPassword, deleteClientAccount } from "@/lib/client-accounts";

export const runtime = "nodejs";

/** PATCH /api/client-accounts/:id — { active?: boolean, password?: string } (solo owner). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isOwner(req)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if (typeof body.active === "boolean") {
    const ok = await setClientActive(id, body.active);
    if (!ok) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  }
  if (typeof body.password === "string" && body.password) {
    const r = await setClientPassword(id, body.password);
    if (r.error) return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

/** DELETE /api/client-accounts/:id (solo owner). */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isOwner(req)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const { id } = await ctx.params;
  const ok = await deleteClientAccount(id);
  if (!ok) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
