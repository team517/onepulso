import { NextRequest, NextResponse } from "next/server";
import { getUnibox } from "@/lib/unibox-store";

export const runtime = "nodejs";

/**
 * GET /api/uniboxes/[id]/public-info
 *
 * Endpoint PÚBLICO (sin auth) que devuelve SOLO el título del unibox.
 * Lo usa la página de login para mostrar el nombre del unibox al que
 * el cliente está accediendo, sin exponer datos sensibles.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getUnibox(id);
  if (!u) return NextResponse.json({ error: "not-found" }, { status: 404 });
  return NextResponse.json({
    id: u.id,
    title: u.title || "",
  });
}
