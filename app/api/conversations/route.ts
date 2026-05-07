import { NextRequest, NextResponse } from "next/server";
import { listConversations, createConversation } from "@/lib/conversations";

export const runtime = "nodejs";

export async function GET() {
  const items = await listConversations();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const conv = await createConversation(body.first_text);
  return NextResponse.json({ conversation: conv });
}
