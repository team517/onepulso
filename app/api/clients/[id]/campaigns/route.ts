import { NextRequest, NextResponse } from "next/server";
import { listCampaigns } from "@/lib/smartlead";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/clients/[id]/campaigns → campañas de ESE cliente en Smartlead. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const camps = await listCampaigns(id);
    return NextResponse.json({ campaigns: camps.map((c) => ({ id: String(c.id), name: c.name, status: c.status })) });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), campaigns: [] }, { status: 200 });
  }
}
