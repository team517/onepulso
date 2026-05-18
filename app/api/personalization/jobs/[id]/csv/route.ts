import { NextResponse } from "next/server";
import { getJob } from "@/lib/personalization";
import { readBlob } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const j = await getJob(id);
  if (!j) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  if (!j.result_csv_key) return NextResponse.json({ error: "el job no tiene CSV resultado todavía" }, { status: 400 });

  const blob = await readBlob(j.result_csv_key);
  if (!blob) return NextResponse.json({ error: "blob no encontrado" }, { status: 404 });

  const safeName = (j.filename || "personalized").replace(/[^a-z0-9._-]/gi, "_");
  return new NextResponse(new Uint8Array(blob.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName.replace(/\.csv$/i, "")}_personalized.csv"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
