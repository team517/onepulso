import { NextResponse } from "next/server";
import { uploadFile, getConfig, isFolderWatched } from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * POST /api/drive/upload
 *   Headers: x-filename, x-folder-id, Content-Type: application/octet-stream
 *   Body: ArrayBuffer del archivo
 */
export async function POST(req: Request) {
  const folderId = req.headers.get("x-folder-id");
  const filenameRaw = req.headers.get("x-filename");
  if (!folderId) return NextResponse.json({ error: "Falta x-folder-id" }, { status: 400 });
  if (!filenameRaw) return NextResponse.json({ error: "Falta x-filename" }, { status: 400 });

  // Seguridad: la carpeta destino debe ser una de las watched
  const cfg = await getConfig();
  if (!isFolderWatched(cfg, folderId)) {
    return NextResponse.json(
      { error: "La carpeta destino no está en tus carpetas seleccionadas. Añádela en /drive primero." },
      { status: 403 }
    );
  }

  const filename = decodeURIComponent(filenameRaw);
  const mimeType = req.headers.get("Content-Type") || "application/octet-stream";

  let buffer: Buffer;
  try {
    const ab = await req.arrayBuffer();
    buffer = Buffer.from(ab);
  } catch (e: any) {
    return NextResponse.json({ error: `No pude leer el archivo: ${e.message}` }, { status: 400 });
  }
  if (buffer.length === 0) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  if (buffer.length > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `Archivo demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Máximo 50 MB.` },
      { status: 413 }
    );
  }

  try {
    const file = await uploadFile(filename, buffer, mimeType, folderId);
    return NextResponse.json({ ok: true, file });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
