import { NextResponse } from "next/server";
import { listCampaigns } from "@/lib/instantly";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data: any = await listCampaigns(50);
    const items = data.items ?? [];
    return NextResponse.json({
      connected: true,
      campaigns_count: items.length,
      sample: items.slice(0, 3).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
    });
  } catch (e: any) {
    return NextResponse.json({ connected: false, error: e.message }, { status: 500 });
  }
}
