import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/instantly";
import { listAccounts, getActiveAccount } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data: any = await listCampaigns(50);
    const items = data.items ?? [];

    // Refrescar y traer info de suscripción de la cuenta activa
    let subscription: any = null;
    let active_title: string | null = null;
    try {
      const accounts = await listAccounts();
      const active = accounts.find((a) => a.active);
      if (active) {
        subscription = active.subscription ?? null;
        active_title = active.title;
      }
    } catch {}

    return NextResponse.json({
      connected: true,
      campaigns_count: items.length,
      count: items.length,
      sample: items.slice(0, 3).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
      subscription,
      active_title,
    });
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: e.message }, { status: 500 });
  }
}
