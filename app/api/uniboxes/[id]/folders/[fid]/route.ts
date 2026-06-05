import { NextRequest, NextResponse } from "next/server";
import { deleteFolder } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/** DELETE /api/uniboxes/[id]/folders/[fid] → borra carpeta y libera mensajes */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const { id, fid } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const r = await deleteFolder(id, fid);
  if (!r.removed) return NextResponse.json({ error: "Carpeta no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true, ...r });
}
