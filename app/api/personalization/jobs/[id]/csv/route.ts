import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { getJob, buildPartialCSV } from "@/lib/personalization";
import { readBlob } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const j = await getJob(id);
  if (!j) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  const flatten = req.nextUrl.searchParams.get("flatten") === "1";
  const partial = req.nextUrl.searchParams.get("partial") === "1";
  const safeName = (j.filename || "personalized").replace(/[^a-z0-9._-]/gi, "_");

  // PARTIAL: construir CSV on-the-fly desde los results actuales, aunque el
  // job esté en curso. Esto permite descargar el progreso mientras se
  // siguen generando mensajes. Igual de seguro porque no muta el job.
  let csvText: string | null = null;
  if (partial || !j.result_csv_key) {
    if ((j.results?.length ?? 0) === 0) {
      return NextResponse.json({ error: "Aún no hay mensajes generados" }, { status: 400 });
    }
    csvText = await buildPartialCSV(id);
    if (!csvText) return NextResponse.json({ error: "No se pudo construir el CSV parcial" }, { status: 500 });
  } else {
    const blob = await readBlob(j.result_csv_key);
    if (!blob) return NextResponse.json({ error: "blob no encontrado" }, { status: 404 });
    csvText = blob.data.toString("utf-8");
  }

  // Quitar BOM si lo tuviera
  if (csvText.charCodeAt(0) === 0xfeff) csvText = csvText.slice(1);

  // Modo "Instantly-compatible": aplanar saltos de línea internos
  if (flatten) {
    const parsed = Papa.parse<string[]>(csvText, {
      header: false,
      skipEmptyLines: "greedy",
      delimiter: ",",
      quoteChar: '"',
      escapeChar: '"',
    });
    const rows = (parsed.data || []).filter((r) => r && r.length > 0);
    const flattened = rows.map((row) =>
      row.map((c) => String(c ?? "").replace(/[\r\n\t]+/g, " ").replace(/  +/g, " ").trim())
    );
    const out = Papa.unparse(flattened, { quotes: true, delimiter: ",", newline: "\r\n" });
    return new NextResponse(out, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeName.replace(/\.csv$/i, "")}${partial ? "_parcial" : ""}_instantly.csv"`,
        "Cache-Control": "private, max-age=0",
      },
    });
  }

  return new NextResponse(csvText, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName.replace(/\.csv$/i, "")}${partial ? "_parcial" : ""}_personalized.csv"`,
      "Cache-Control": "private, max-age=0",
    },
  });
}
