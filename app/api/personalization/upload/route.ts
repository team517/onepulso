import { NextResponse } from "next/server";
import { saveCSVBlobOnly } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE = 50 * 1024 * 1024;

/** POST /api/personalization/upload — sube un CSV (binario crudo + x-filename).
 *  Sólo guarda los bytes y devuelve el file_id de inmediato. El parseo se
 *  hace después via /api/personalization/upload/parse-stream (SSE) que
 *  emite progreso por lotes de 100 filas. */
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
    return NextResponse.json({ error: `Archivo demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Máximo 50 MB.` }, { status: 413 });
  }

  try {
    const meta = await saveCSVBlobOnly(filename, buffer);
    console.log(`[csv upload] file=${filename} receivedBytes=${buffer.length} (${(buffer.length / 1024 / 1024).toFixed(2)} MB) file_id=${meta.file_id}`);
    return NextResponse.json({
      ok: true,
      file_id: meta.file_id,
      filename: meta.filename,
      size: meta.size,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
