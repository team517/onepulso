import { NextResponse } from "next/server";
import { listCampaignRecords } from "@/lib/campaigns-store";

export const runtime = "nodejs";

export async function GET() {
  const records = await listCampaignRecords();
  return NextResponse.json({ records });
}
