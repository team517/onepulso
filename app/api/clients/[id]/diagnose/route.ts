import { NextRequest, NextResponse } from "next/server";
import { listCampaigns, getCampaignAnalytics, getCampaignAnalyticsRaw } from "@/lib/smartlead";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/clients/[id]/diagnose
 * Muestra las campañas del cliente + la respuesta CRUDA de analíticas de la
 * primera + los números que extraemos. Útil si el PDF sale con métricas en 0:
 * revela qué nombres de campo usa realmente Smartlead.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const campaigns = await listCampaigns(id);
    const first = campaigns[0];
    let raw: any = null, parsed: any = null;
    if (first) {
      raw = await getCampaignAnalyticsRaw(first.id).catch((e) => ({ error: e.message }));
      parsed = await getCampaignAnalytics(first.id).catch((e) => ({ error: e.message }));
    }
    return NextResponse.json({
      client_id: id,
      campaign_count: campaigns.length,
      campaigns: campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status })),
      first_campaign: first ? { id: first.id, name: first.name } : null,
      analytics_raw: raw,
      analytics_parsed: parsed,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
