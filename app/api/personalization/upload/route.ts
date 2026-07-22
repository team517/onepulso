import { NextResponse } from "next/server";
import { saveCSVBlobOnly } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_SIZE = 100 * 1024 * 1024;

/** POST /api/personalization/upload — sube un CSV (binario crudo + x-filename).
 *  Sólo guarda los bytes y devuelve el file_id de inmediato. El parseo se
 *  hace después via /api/personalization/upload/parse-stream (SSE) que
 *  emite progreso por lotes de 100 filas. */
export async function POST(req: Request) {
  const filenameRaw = req.headers.get("x-filename");
  if (!filenameRaw) return NextResponse.json({ error: "Falta x-filename" }, { status: 400 });
  const filename = decodeURIComponent(filenameRaw);

  const contentLength = req.headers.get("content-length");
  const expectedBytes = contentLength ? parseInt(contentLength, 10) : -1;

  let buffer: Buffer;
  try {
    // LECTURA POR STREAMING en lugar de arrayBuffer() — evita límites
    // internos de tamaño en algunos runtimes/frameworks que se aplican al
    // cargar todo de golpe en memoria. Acumulamos chunks manualmente.
    if (!req.body) throw new Error("Sin body en la request");
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.length;
        if (total > MAX_SIZE) {
          throw new Error(`Archivo excede el límite (${(total / 1024 / 1024).toFixed(1)} MB > 100 MB)`);
        }
      }
    }
    buffer = Buffer.concat(chunks, total);
  } catch (e: any) {
    return NextResponse.json({ error: `No pude leer el archivo: ${e.message}`, expected: expectedBytes }, { status: 400 });
  }
  if (buffer.length === 0) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  if (buffer.length > MAX_SIZE) {
    return NextResponse.json({ error: `Archivo demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Máximo 100 MB.` }, { status: 413 });
  }

  // DIAGNÓSTICO: si Content-Length difiere del recibido, hay truncación
  if (expectedBytes > 0 && Math.abs(buffer.length - expectedBytes) > 16) {
    console.warn(`[csv upload] TRUNCATION DETECTED: contentLength=${expectedBytes} bytes but received=${buffer.length}`);
  }

  try {
    const meta = await saveCSVBlobOnly(filename, buffer);
    console.log(`[csv upload] file=${filename} contentLength=${expectedBytes} receivedBytes=${buffer.length} (${(buffer.length / 1024 / 1024).toFixed(2)} MB) file_id=${meta.file_id}`);
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
