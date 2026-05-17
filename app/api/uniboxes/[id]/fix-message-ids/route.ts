import { NextRequest, NextResponse } from "next/server";
import { loadMessagesMap, saveMessagesMap } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/**
 * POST /api/uniboxes/[id]/fix-message-ids
 * Normaliza TODOS los mensajes cacheados envolviendo messageId/inReplyTo/references
 * en <...> para garantizar que el threading funcione al responder.
 * Útil después del fix para arreglar mensajes guardados anteriormente.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const wrap = (s: string): string => {
    const t = String(s || "").trim();
    if (!t) return "";
    const cleaned = t.replace(/^<+|>+$/g, "");
    return cleaned ? `<${cleaned}>` : "";
  };

  const msgsMap = await loadMessagesMap(id);
  let total = 0;
  let touched = 0;
  for (const accId of Object.keys(msgsMap)) {
    for (const m of msgsMap[accId]) {
      total++;
      const oldMid = m.messageId;
      const oldInReply = m.inReplyTo;
      const oldRefs = JSON.stringify(m.references || []);
      m.messageId = wrap(m.messageId);
      m.inReplyTo = wrap(m.inReplyTo || "");
      m.references = (m.references || []).map(wrap).filter(Boolean);
      const newRefs = JSON.stringify(m.references);
      if (oldMid !== m.messageId || oldInReply !== m.inReplyTo || oldRefs !== newRefs) {
        touched++;
      }
    }
  }
  await saveMessagesMap(id, msgsMap);
  return NextResponse.json({ ok: true, total, normalized: touched });
}
