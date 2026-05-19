import { NextResponse } from "next/server";
import { resumeJob } from "@/lib/personalization";

export const runtime = "nodejs";
export const maxDuration = 600;

/** POST /api/personalization/jobs/[id]/resume — reanuda un job interrumpido. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    // Disparar el resume en background (no esperar)
    resumeJob(id).catch((e) => {
      console.error(`[personalization] resume ${id} fatal:`, e?.message || e);
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
