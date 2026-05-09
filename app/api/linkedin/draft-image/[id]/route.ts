import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { readBlob } from "@/lib/storage";

export const runtime = "nodejs";

/**
 * GET /api/linkedin/draft-image/:id
 * Sirve una imagen de borrador (no asociada todavía a un post).
 * El id es un nombre de archivo (uuid + .png).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const safe = path.basename(id).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const blob = await readBlob(`linkedin-images/${safe}`);
  if (!blob) return NextResponse.json({ error: "imagen no encontrada" }, { status: 404 });

  return new NextResponse(new Uint8Array(blob.data), {
    headers: {
      "Content-Type": blob.mime,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
