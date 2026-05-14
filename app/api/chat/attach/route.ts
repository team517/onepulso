import { NextRequest, NextResponse } from "next/server";
import { extractFile } from "@/lib/file-extract";
import { saveCSV } from "@/lib/csv";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e: any) {
    return NextResponse.json(
      { error: `No pude leer el archivo: ${e?.message || "formato no válido"}` },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No se adjuntó ningún archivo" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `Archivo demasiado grande (${(file.size / 1024 / 1024).toFixed(1)} MB). Máximo: 20 MB.` },
      { status: 413 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "El archivo está vacío" }, { status: 400 });
  }

  const ext = (file.name.split(".").pop() ?? "").toLowerCase();

  // CSVs / TSVs: guardar en Postgres blob_store y devolver metadata + sample
  if (ext === "csv" || ext === "tsv") {
    try {
      const meta = await saveCSV(file.name, buffer);
      if (meta.columns.length === 0 || meta.row_count === 0) {
        return NextResponse.json(
          { error: `El CSV se subió pero no tiene datos válidos (${meta.row_count} filas, ${meta.columns.length} columnas).` },
          { status: 400 }
        );
      }
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
    } catch (e: any) {
      console.error("[/api/chat/attach] CSV error:", e);
      return NextResponse.json(
        { error: `Error procesando CSV: ${e?.message || "fallo desconocido"}. Revisa que sea un CSV/TSV válido.` },
        { status: 500 }
      );
    }
  }

  // Resto: extraer texto
  try {
    const extracted = await extractFile(file.name, buffer);
    return NextResponse.json({
      name: file.name,
      size: buffer.length,
      format: extracted.format,
      kind: "text",
      truncated: extracted.truncated ?? false,
      text: extracted.text,
    });
  } catch (e: any) {
    console.error("[/api/chat/attach] extract error:", e);
    return NextResponse.json(
      { error: `No pude extraer el contenido (${ext}): ${e?.message || "formato no soportado"}` },
      { status: 500 }
    );
  }
}
