import { NextRequest, NextResponse } from "next/server";
import { syncInbox } from "@/lib/email-inbox";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const days = Number(body.days ?? 7);
  const max = Number(body.max ?? 50);
  const result = await syncInbox({ days, max });
  return NextResponse.json(result);
}
