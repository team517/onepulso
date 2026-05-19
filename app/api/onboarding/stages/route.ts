import { NextRequest, NextResponse } from "next/server";
import { listStages, createStage, reorderStages } from "@/lib/onboarding";

export async function GET() {
  const stages = await listStages();
  return NextResponse.json({ stages });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title requerido" }, { status: 400 });
  }
  const stage = await createStage({
    title: body.title,
    description: body.description,
    icon: body.icon,
  });
  return NextResponse.json({ stage });
}

/** PATCH /api/onboarding/stages  body: { orderedIds: string[] }  → reordena */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.orderedIds)) {
    return NextResponse.json({ error: "orderedIds requerido" }, { status: 400 });
  }
  const stages = await reorderStages(body.orderedIds);
  return NextResponse.json({ stages });
}
