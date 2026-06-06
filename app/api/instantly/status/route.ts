import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/instantly";
import { listAccounts } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

// Cache 5 minutos del status. La llamada a Instantly tarda 5-25s en cold start.
// Con cache, las visitas siguientes son instantáneas.
let _cached: { ts: number; data: any } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export async function GET() {
  // Fast path: si tenemos cache reciente, devolvemos inmediatamente
  if (_cached && Date.now() - _cached.ts < CACHE_MS) {
    return NextResponse.json({ ..._cached.data, cached: true });
  }

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

    const result = {
      connected: true,
      campaigns_count: items.length,
      count: items.length,
      sample: items.slice(0, 3).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
      active_title,
      renews_at,
      plan_label,
      days_remaining,
    };
    _cached = { ts: Date.now(), data: result };
    return NextResponse.json(result);
  } catch (e: any) {
    // Cachear también los errores brevemente (1 min) para no martillar
    // a Instantly si está caído.
    const errorResult = { connected: false, error: e.message };
    _cached = { ts: Date.now() - (CACHE_MS - 60_000), data: errorResult };
    return NextResponse.json(errorResult, { status: 500 });
  }
}
