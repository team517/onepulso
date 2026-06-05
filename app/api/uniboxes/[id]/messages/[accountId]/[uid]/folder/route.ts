import { NextRequest, NextResponse } from "next/server";
import { setMessageFolder } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/**
 * PATCH /api/uniboxes/[id]/messages/[accountId]/[uid]/folder
 * Body: { folder_id: string | null }
 * Asigna el mensaje a una carpeta custom o lo libera (null).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; uid: string }> }
) {
  const { id, accountId, uid } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const folderId: string | null = body?.folder_id ?? null;
  const ok = await setMessageFolder(id, accountId, Number(uid), folderId);
  if (!ok) return NextResponse.json({ error: "Mensaje no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
