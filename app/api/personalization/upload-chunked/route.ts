import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { readBlob, writeBlob } from "@/lib/storage";
import { saveCSVBlobOnly } from "@/lib/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Chunked upload — sortea el límite de ~10 MB que Next.js impone a los
 * Route Handlers.
 *
 * Protocolo:
 *  POST /api/personalization/upload-chunked
 *    Headers:
 *      x-upload-id: uuid (genera el cliente al empezar, lo manda en TODOS los chunks)
 *      x-chunk-index: 0..N-1
 *      x-total-chunks: N
 *      x-filename: nombre del archivo (urlencoded)
 *      Content-Type: application/octet-stream
 *    Body: bytes del chunk (max 8 MB cada uno por seguridad).
 *
 *    Respuesta intermedia: { ok: true, chunk: i }
 *    Respuesta del último chunk: { ok: true, complete: true, file_id, size, filename }
 *
 * Almacenamiento de chunks: blob_store con key "upload-chunks/{upload_id}/{i}".
 * Cuando llega el último, concatenamos todos, guardamos como CSV normal y
 * limpiamos los chunks parciales.
 */
const CHUNK_PREFIX = "upload-chunks/";
const MAX_CHUNK = 8 * 1024 * 1024;  // 8 MB por chunk — bajo el límite de 10 MB
const MAX_TOTAL = 100 * 1024 * 1024; // 100 MB total

export async function POST(req: NextRequest) {
  const uploadId = req.headers.get("x-upload-id");
  const chunkIndex = parseInt(req.headers.get("x-chunk-index") || "-1", 10);
  const totalChunks = parseInt(req.headers.get("x-total-chunks") || "-1", 10);
  const filenameRaw = req.headers.get("x-filename");

  if (!uploadId || !/^[a-z0-9-]{10,}$/i.test(uploadId)) {
    return NextResponse.json({ error: "x-upload-id inválido" }, { status: 400 });
  }
  if (chunkIndex < 0 || totalChunks <= 0 || chunkIndex >= totalChunks) {
    return NextResponse.json({ error: "indices de chunk inválidos" }, { status: 400 });
  }
  if (totalChunks > 200) {
    return NextResponse.json({ error: "demasiados chunks (max 200)" }, { status: 400 });
  }
  if (!filenameRaw) {
    return NextResponse.json({ error: "x-filename requerido" }, { status: 400 });
  }
  const filename = decodeURIComponent(filenameRaw);

  // Leer el chunk como stream para evitar el límite de arrayBuffer.
  let chunk: Buffer;
  try {
    if (!req.body) throw new Error("Sin body");
    const reader = req.body.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_CHUNK) {
          throw new Error(`Chunk excede ${MAX_CHUNK} bytes (recibidos ${total})`);
        }
        parts.push(value);
      }
    }
    chunk = Buffer.concat(parts, total);
  } catch (e: any) {
    return NextResponse.json({ error: `Lectura del chunk falló: ${e.message}` }, { status: 400 });
  }

  // Guardar el chunk
  const chunkKey = `${CHUNK_PREFIX}${uploadId}/${chunkIndex}`;
  await writeBlob(chunkKey, chunk, "application/octet-stream");
  console.log(`[chunked-upload] uploadId=${uploadId} chunk=${chunkIndex}/${totalChunks - 1} bytes=${chunk.length}`);

  // Si NO es el último chunk, responder y esperar más.
  if (chunkIndex < totalChunks - 1) {
    return NextResponse.json({ ok: true, chunk: chunkIndex });
  }

  // ÚLTIMO chunk: leer todos los chunks, concatenarlos y crear el CSV.
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for (let i = 0; i < totalChunks; i++) {
    const blob = await readBlob(`${CHUNK_PREFIX}${uploadId}/${i}`);
    if (!blob) {
      return NextResponse.json({ error: `Chunk ${i} no encontrado — re-sube todo` }, { status: 400 });
    }
    chunks.push(blob.data);
    totalSize += blob.data.length;
    if (totalSize > MAX_TOTAL) {
      return NextResponse.json({ error: `Archivo total ${(totalSize / 1024 / 1024).toFixed(1)} MB > ${MAX_TOTAL / 1024 / 1024} MB` }, { status: 413 });
    }
  }
  const fullBuffer = Buffer.concat(chunks, totalSize);
  console.log(`[chunked-upload] uploadId=${uploadId} COMPLETE totalBytes=${fullBuffer.length} (${(fullBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

  // Guardar como CSV
  const meta = await saveCSVBlobOnly(filename, fullBuffer);

  // Limpiar chunks
  try {
    const { withClient } = await import("@/lib/db");
    await withClient((c) =>
      c.query("DELETE FROM blob_store WHERE key LIKE $1", [`${CHUNK_PREFIX}${uploadId}/%`])
    );
  } catch (e: any) {
    console.warn("[chunked-upload] cleanup falló:", e.message);
  }

  return NextResponse.json({
    ok: true,
    complete: true,
    file_id: meta.file_id,
    filename: meta.filename,
    size: meta.size,
  });
}
