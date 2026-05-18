import { NextResponse } from "next/server";
import { saveCSV } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE = 20 * 1024 * 1024;

/** POST /api/personalization/upload — sube un CSV (binario crudo + x-filename) */
export async function POST(req: Request) {
  const filenameRaw = req.headers.get("x-filename");
  if (!filenameRaw) return NextResponse.json({ error: "Falta x-filename" }, { status: 400 });
  const filename = decodeURIComponent(filenameRaw);

  let buffer: Buffer;
  try {
    const ab = await req.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch (e: any) {
    return NextResponse.json({ error: `No pude leer el archivo: ${e.message}` }, { status: 400 });
  }
  if (buffer.length === 0) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  if (buffer.length > MAX_SIZE) {
    return NextResponse.json({ error: `Archivo demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Máximo 20 MB.` }, { status: 413 });
  }

  try {
    const meta = await saveCSV(filename, buffer);
    return NextResponse.json({
      ok: true,
      file_id: meta.file_id,
      filename: meta.filename,
      columns: meta.columns,
      row_count: meta.row_count,
      preview: meta.preview,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
