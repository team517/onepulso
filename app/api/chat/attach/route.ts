import { NextRequest, NextResponse } from "next/server";
import { extractFile } from "@/lib/file-extract";
import { saveCSV } from "@/lib/csv";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();

  // CSVs grandes: guardar a disco y devolver metadata + sample, NO el contenido completo
  if (ext === "csv" || ext === "tsv") {
    const meta = await saveCSV(file.name, buffer);
    const summaryText = [
      `[CSV ATTACHED: ${meta.filename}]`,
      `file_id: ${meta.file_id}`,
      `rows: ${meta.row_count}`,
      `columns: ${meta.columns.join(", ")}`,
      `preview (3 rows):`,
      ...meta.preview.map((r) => "  " + JSON.stringify(r)),
      `[Para subir a campaña: usar tool upload_leads_from_csv_file con este file_id]`,
    ].join("\n");
    return NextResponse.json({
      name: file.name,
      size: buffer.length,
      format: "csv",
      kind: "csv",
      file_id: meta.file_id,
      columns: meta.columns,
      row_count: meta.row_count,
      text: summaryText,
    });
  }

  // Resto: extraer texto como antes
  const extracted = await extractFile(file.name, buffer);
  return NextResponse.json({
    name: file.name,
    size: buffer.length,
    format: extracted.format,
    kind: "text",
    truncated: extracted.truncated ?? false,
    text: extracted.text,
  });
}
