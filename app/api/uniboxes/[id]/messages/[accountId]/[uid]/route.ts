import { NextRequest, NextResponse } from "next/server";
import { loadMessagesMap } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; uid: string }> }
) {
  const { id, accountId, uid } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const map = await loadMessagesMap(id);
  const msgs = map[accountId] || [];
  const msg = msgs.find((m) => String(m.uid) === String(uid));
  if (!msg) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(msg);
}
