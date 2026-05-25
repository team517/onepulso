import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getJob } from "@/lib/personalization";
import { readBlob } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const j = await getJob(id);
  if (!j) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  if (!j.result_csv_key) return NextResponse.json({ error: "el job no tiene CSV resultado todavía" }, { status: 400 });

  const blob = await readBlob(j.result_csv_key);
  if (!blob) return NextResponse.json({ error: "blob no encontrado" }, { status: 404 });

  const safeName = (j.filename || "personalized").replace(/[^a-z0-9._-]/gi, "_");
  const flatten = req.nextUrl.searchParams.get("flatten") === "1";

  // Modo "Instantly-compatible": re-parsear el CSV y emitirlo sin saltos de
  // línea dentro de las celdas (los importadores básicos como Instantly se
  // rompen con campos multi-linea aunque esten correctamente entrecomillados).
  if (flatten) {
    let text = blob.data.toString("utf-8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: "greedy",
      delimiter: ",",
      quoteChar: '"',
      escapeChar: '"',
    });
    const rows = (parsed.data || []).filter((r) => r && r.length > 0);
    // Aplanar TODAS las celdas: cualquier \r \n \t → un espacio. trim final.
    const flattened = rows.map((row) =>
      row.map((c) => String(c ?? "").replace(/[\r\n\t]+/g, " ").replace(/  +/g, " ").trim())
    );
    const csv = Papa.unparse(flattened, {
      quotes: true, // entrecomillar TODAS las celdas — máxima compat
      delimiter: ",",
      newline: "\r\n",
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName.replace(/\.csv$/i, "")}_instantly.csv"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  }

  return new NextResponse(new Uint8Array(blob.data), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName.replace(/\.csv$/i, "")}_personalized.csv"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
