import { NextRequest, NextResponse } from "next/server";
import { listAllScheduledFollowupsLight, scheduleFollowup, scheduleFollowupsBatch } from "@/lib/email-threads";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const items = await listAllScheduledFollowupsLight();
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { thread_id, body_html, scheduled_at, origin, steps } = body;
  if (!thread_id) {
    return NextResponse.json({ error: "thread_id requerido" }, { status: 400 });
  }

  // MODO BATCH: varios pasos en una sola escritura del blob (rápido, sin timeout).
  if (Array.isArray(steps)) {
    const clean = steps
      .filter((s: any) => s && s.body_html && s.scheduled_at)
      .map((s: any) => ({ body_html: s.body_html, scheduled_at: new Date(s.scheduled_at).toISOString() }));
    if (clean.length === 0) {
      return NextResponse.json({ error: "ningún paso válido (falta body_html o scheduled_at)" }, { status: 400 });
    }
    const r = await scheduleFollowupsBatch({ thread_id, origin: origin ?? "manual", steps: clean });
    if (r.error) return NextResponse.json({ error: r.error }, { status: r.error === "thread no encontrado" ? 404 : 400 });
    return NextResponse.json({ scheduled: r.scheduled, count: r.scheduled.length });
  }

  // MODO SINGLE (compatibilidad).
  if (!body_html || !scheduled_at) {
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
