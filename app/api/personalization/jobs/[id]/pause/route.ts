import { withRequestTenant } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { pauseJob } from "@/lib/personalization";

export const runtime = "nodejs";

/** POST /api/personalization/jobs/[id]/pause — marca el job como "paused".
 *  El loop de runJob lo detecta al inicio del siguiente lote y aborta. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return withRequestTenant(_req as any, async () => {
  const { id } = await ctx.params;
  const job = await pauseJob(id);
  if (!job) return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true, job });

  }) as any;
}
