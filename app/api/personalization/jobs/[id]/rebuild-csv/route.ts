import { NextResponse } from "next/server";
import { getJob, rebuildCSV } from "@/lib/personalization";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/personalization/jobs/[id]/rebuild-csv
 * Regenera el CSV resultado USANDO original_selected_rows, sin volver a
 * pasar leads por el LLM. Sirve para arreglar jobs antiguos cuyo CSV se
 * construyó con selected_rows mutado tras un resume.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: "Job no encontrado" }, { status: 404 });
  try {
    const result = await rebuildCSV(id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
