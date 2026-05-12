import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/instantly";
import { listAccounts } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data: any = await listCampaigns(50);
    const items = data.items ?? [];

    let active_title: string | null = null;
    let renews_at: string | undefined;
    let plan_label: string | undefined;
    let days_remaining: number | undefined;
    try {
      const accounts = await listAccounts();
      const active = accounts.find((a) => a.active);
      if (active) {
        active_title = active.title;
        renews_at = active.renews_at;
        plan_label = active.plan_label;
        days_remaining = active.days_remaining;
      }
    } catch {}

    return NextResponse.json({
      connected: true,
      campaigns_count: items.length,
      count: items.length,
      sample: items.slice(0, 3).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
      active_title,
      renews_at,
      plan_label,
      days_remaining,
    });
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: e.message }, { status: 500 });
  }
}
