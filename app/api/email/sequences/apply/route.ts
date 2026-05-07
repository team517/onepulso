import { NextRequest, NextResponse } from "next/server";
import { applySequence } from "@/lib/email-sequences";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { sequence_id, thread_id, base_date } = body;
  if (!sequence_id || !thread_id) {
    return NextResponse.json({ error: "sequence_id y thread_id requeridos" }, { status: 400 });
  }
  try {
    const r = await applySequence({ sequence_id, thread_id, base_date });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
