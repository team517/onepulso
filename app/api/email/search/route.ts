import { NextRequest, NextResponse } from "next/server";
import { searchEmails } from "@/lib/email-search";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { query, max } = await req.json();
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "query requerido" }, { status: 400 });
  }
  const r = await searchEmails(query, Number(max ?? 30));
  return NextResponse.json(r);
}
