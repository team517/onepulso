import { NextResponse } from "next/server";
import { readCSVRows, generateForRow, applyMapping } from "@/lib/personalization";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/personalization/preview
 * Body: { file_id, mapping, prompt, provider, row_index }
 * Genera 1 mensaje de muestra usando una fila concreta del CSV.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { file_id, mapping, prompt, provider, row_index } = body;
  if (!file_id || !mapping || !prompt) {
    return NextResponse.json({ error: "Faltan file_id, mapping y/o prompt" }, { status: 400 });
  }
  try {
    const { rows, columns } = await readCSVRows(file_id);
    if (rows.length === 0) return NextResponse.json({ error: "El CSV no tiene filas" }, { status: 400 });
    const idx = typeof row_index === "number" && row_index >= 0 && row_index < rows.length ? row_index : 0;
    const row = rows[idx];
    const resolvedPrompt = applyMapping(prompt, row, mapping);
    const message = await generateForRow(prompt, row, mapping, provider || "claude");
    return NextResponse.json({
      ok: true,
      row_index: idx,
      lead: row,
      resolved_prompt: resolvedPrompt,
      message,
      columns,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
