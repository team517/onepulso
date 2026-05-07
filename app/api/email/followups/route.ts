import { NextRequest, NextResponse } from "next/server";
import { listAllScheduledFollowups, scheduleFollowup } from "@/lib/email-threads";

export const runtime = "nodejs";

export async function GET() {
  const items = await listAllScheduledFollowups();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { thread_id, body_html, scheduled_at, origin } = body;
  if (!thread_id || !body_html || !scheduled_at) {
    return NextResponse.json({ error: "thread_id, body_html y scheduled_at requeridos" }, { status: 400 });
  }
  const f = await scheduleFollowup({
    thread_id,
    body_html,
    scheduled_at: new Date(scheduled_at).toISOString(),
    origin: origin ?? "manual",
  });
  if (!f) return NextResponse.json({ error: "thread no encontrado" }, { status: 404 });
  return NextResponse.json({ followup: f });
}
