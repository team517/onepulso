import { NextRequest, NextResponse } from "next/server";
import { importThread } from "@/lib/email-import";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const { gm_thrid, subject_seed, participant_seed } = await req.json();
  if (!gm_thrid && !(subject_seed && participant_seed)) {
    return NextResponse.json(
      { error: "gm_thrid o (subject_seed + participant_seed) requeridos" },
      { status: 400 }
    );
  }
  const r = await importThread({ gm_thrid, subject_seed, participant_seed });
  if (r.error) return NextResponse.json(r, { status: 500 });
  return NextResponse.json(r);
}
