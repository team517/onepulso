import { withRequestTenant } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { restartJob } from "@/lib/personalization";

export const runtime = "nodejs";
export const maxDuration = 600;

/** POST /api/personalization/jobs/[id]/restart — limpia results, restaura
 *  selected_rows al original y arranca de cero (en background). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(_req as any, async () => {
  const { id } = await ctx.params;
  const job = await restartJob(id, true);
  if (!job) return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, job });

  }) as any;
}
