import { NextResponse } from "next/server";
import { listSavedCampaigns, createSavedCampaign } from "@/lib/saved-campaigns";

export const runtime = "nodejs";

export async function GET() {
  const campaigns = await listSavedCampaigns();
  return NextResponse.json({ campaigns });
}

export async function POST(req: Request) {
  const body = await req.json();
  const required = ["name", "file_id", "filename", "total_rows", "columns", "mapping", "prompt"];
  for (const r of required) {
    if (body[r] === undefined || body[r] === null) {
      return NextResponse.json({ error: `Falta ${r}` }, { status: 400 });
    }
  }
  const campaign = await createSavedCampaign({
    name: body.name,
    description: body.description,
    file_id: body.file_id,
    filename: body.filename,
    total_rows: body.total_rows,
    columns: body.columns,
    mapping: body.mapping,
    prompt: body.prompt,
    provider: body.provider || "claude",
  });
  return NextResponse.json({ campaign });
}
