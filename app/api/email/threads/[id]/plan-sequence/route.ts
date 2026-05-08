import { NextRequest, NextResponse } from "next/server";
import { planAndScheduleSequence } from "@/lib/email-autopilot";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/email/threads/:id/plan-sequence
 * Body: {
 *   num_steps?: number (default 5),
 *   strategy?: string,
 *   custom_days?: number[],          // ej. [0, 2, 5, 10, 21]
 *   send_first_immediately?: boolean,
 *   default_hour?: number,            // 10 por defecto
 * }
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = await req.json().catch(() => ({}));
    const numSteps = Math.max(1, Math.min(10, parseInt(body.num_steps) || 5));
    const strategy: string = body.strategy || "Equilibrada";

    const customDays: number[] | undefined = Array.isArray(body.custom_days)
      ? body.custom_days
          .map((d: any) => parseInt(String(d)))
          .filter((d: number) => !isNaN(d) && d >= 0 && d <= 365)
      : undefined;

    const sendFirstImmediately: boolean = body.send_first_immediately === true;
    const defaultHour: number =
      typeof body.default_hour === "number" && body.default_hour >= 0 && body.default_hour <= 23
        ? body.default_hour
        : 10;

    const result = await planAndScheduleSequence(id, numSteps, strategy, {
      customDays,
      sendFirstImmediately,
      defaultHour,
    });

    return NextResponse.json({
      ok: true,
      scheduled: result.scheduled,
      sent_now: result.sent_now,
      steps: result.steps.map((s, i) => ({
        index: i,
        day: customDays?.[i] ?? s.day,
        intent: s.intent,
        preview: s.body_html.replace(/<[^>]+>/g, " ").slice(0, 140),
      })),
    });
  } catch (e: any) {
    console.error("[plan-sequence]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
