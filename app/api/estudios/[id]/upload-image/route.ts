import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { writeBlob } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 8 * 1024 * 1024;

/**
 * POST /api/estudios/[id]/upload-image
 * Body: binario crudo de la imagen.
 * Headers: x-mime (image/png, image/jpeg, etc.)
 * Devuelve: { src_key } para meter en el elemento ImageElement.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const mime = req.headers.get("x-mime") || "image/png";
  if (!/^image\//.test(mime)) {
    return NextResponse.json({ error: "Tipo no permitido" }, { status: 400 });
  }
  let buf: Buffer;
  try {
    const ab = await req.arrayBuffer();
    buf = Buffer.from(ab);
  } catch (e: any) {
    return NextResponse.json({ error: `No pude leer la imagen: ${e.message}` }, { status: 400 });
  }
  if (buf.length === 0) return NextResponse.json({ error: "Imagen vacía" }, { status: 400 });
  if (buf.length > MAX_SIZE) {
    return NextResponse.json({ error: `Imagen demasiado grande (max 8 MB)` }, { status: 413 });
  }
  const src_key = `estudios-img/${id}/${randomUUID()}`;
  await writeBlob(src_key, buf, mime);
  return NextResponse.json({ src_key });
}
