import { withRequestTenant } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { getSavedCampaign, updateSavedCampaign, deleteSavedCampaign, markCampaignUsed } from "@/lib/saved-campaigns";
import { readBlob } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(_req as any, async () => {
  const { id } = await ctx.params;
  const c = await getSavedCampaign(id);
  if (!c) return NextResponse.json({ error: "no encontrada" }, { status: 404 });

  // Verificar que el CSV blob siga existiendo
  const blob = await readBlob(`csv/${c.file_id}`);
  const file_available = !!blob;

  return NextResponse.json({ campaign: c, file_available });

  }) as any;
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(req as any, async () => {
  const { id } = await ctx.params;
  const body = await req.json();
  if (body.action === "mark_used") {
    await markCampaignUsed(id);
    return NextResponse.json({ ok: true });
  }
  const c = await updateSavedCampaign(id, body);
  if (!c) return NextResponse.json({ error: "no encontrada" }, { status: 404 });
  return NextResponse.json({ campaign: c });

  }) as any;
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(_req as any, async () => {
  const { id } = await ctx.params;
  await deleteSavedCampaign(id);
  return NextResponse.json({ ok: true });

  }) as any;
}
