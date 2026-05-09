import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dataPath } from "@/lib/data-dir";

export const runtime = "nodejs";

const DRAFT_DIR = dataPath("linkedin-images");

/**
 * GET /api/linkedin/draft-image/:id
 * Sirve una imagen de borrador (no asociada todavía a un post).
 * El id es un nombre de archivo (uuid + .png).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Sanitizar: solo permitir basenames sencillos
  const safe = path.basename(id).replace(/[^a-zA-Z0-9._-]/g, "");
  if (!safe) return NextResponse.json({ error: "id inválido" }, { status: 400 });

  const filePath = path.join(DRAFT_DIR, safe);
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(safe).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" :
      ext === ".webp" ? "image/webp" :
      "image/png";
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return NextResponse.json({ error: "imagen no encontrada" }, { status: 404 });
  }
}
