import { NextResponse } from "next/server";
import { listDocuments, createDocument, listFolders } from "@/lib/documents";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

export async function GET() {
  const [docs, folders] = await Promise.all([listDocuments(), listFolders()]);
  return NextResponse.json({ documents: docs, folders });
}

/**
 * POST /api/documents — sube un archivo binario
 *   Headers: x-filename, x-folder (opcional), x-client-name (opcional), x-notes (opcional)
 *   Body: ArrayBuffer del archivo
 */
export async function POST(req: Request) {
  const filenameRaw = req.headers.get("x-filename");
  if (!filenameRaw) return NextResponse.json({ error: "Falta x-filename" }, { status: 400 });

  const filename = decodeURIComponent(filenameRaw);
  const mime = req.headers.get("Content-Type") || "application/octet-stream";
  const folder = req.headers.get("x-folder") ? decodeURIComponent(req.headers.get("x-folder")!) : undefined;
  const clientName = req.headers.get("x-client-name") ? decodeURIComponent(req.headers.get("x-client-name")!) : undefined;
  const notes = req.headers.get("x-notes") ? decodeURIComponent(req.headers.get("x-notes")!) : undefined;
  const tagsHeader = req.headers.get("x-tags");
  const tags = tagsHeader ? decodeURIComponent(tagsHeader).split(",").map((t) => t.trim()).filter(Boolean) : undefined;

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
      { error: `Archivo demasiado grande (${(buffer.length / 1024 / 1024).toFixed(1)} MB). Máximo 25 MB.` },
      { status: 413 }
    );
  }

  try {
    const doc = await createDocument({
      filename,
      mime,
      buffer,
      folder,
      tags,
      client_name: clientName,
      notes,
    });
    return NextResponse.json({ ok: true, document: doc });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
