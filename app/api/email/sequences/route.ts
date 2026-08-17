import { withRequestTenant } from "@/lib/client-auth";
import { NextRequest, NextResponse } from "next/server";
import { listSequences, saveSequence } from "@/lib/email-sequences";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withRequestTenant(req as any, async () => {
  const sequences = await listSequences();
  return NextResponse.json({ sequences });

  }) as any;
}

export async function POST(req: NextRequest) {
  return withRequestTenant(req as any, async () => {
  const body = await req.json();
  if (!body.name || !Array.isArray(body.steps)) {
    return NextResponse.json({ error: "name y steps requeridos" }, { status: 400 });
  }
  const seq = await saveSequence({
    id: body.id,
    name: body.name,
    description: body.description,
    steps: body.steps,
  });
  return NextResponse.json({ sequence: seq });

  }) as any;
}
