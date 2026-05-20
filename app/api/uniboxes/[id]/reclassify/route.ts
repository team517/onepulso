import { NextRequest, NextResponse } from "next/server";
import { reclassifyMessages } from "@/lib/unibox-sync";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

/**
 * POST /api/uniboxes/[id]/reclassify
 * Re-aplica isWarmupMessage() a todos los mensajes cacheados de la unibox.
 * Útil cuando el algoritmo de detección se ha actualizado y los mensajes
 * antiguos están con is_warmup=false.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const r = await reclassifyMessages(id);
  return NextResponse.json({ ok: true, ...r });
}
