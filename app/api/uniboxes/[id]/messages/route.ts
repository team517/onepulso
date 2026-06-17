import { NextRequest, NextResponse } from "next/server";
import { getUnibox, clearAllMessages, purgeBounces } from "@/lib/unibox-store";
import { listMessagesPage } from "@/lib/unibox-messages-db";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const u = await getUnibox(id);
  if (!u) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const url = new URL(req.url);
  const accountFilter = url.searchParams.get("account");
  const showWarmup = url.searchParams.get("show_warmup") === "1";

  // Paginación opcional: ?limit=N, ?offset=N. ?all=1 o ?limit=0 → tope duro.
  const limitParam = parseInt(url.searchParams.get("limit") || "2000", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const all = url.searchParams.get("all") === "1" || limitParam === 0;

  // Lectura PAGINADA e INDEXADA desde la tabla unibox_messages — ya NO carga
  // todos los mensajes en RAM. Los bounces no se almacenan, así que no hay
  // que filtrarlos aquí. El cuerpo (text/html) se pide al abrir el mensaje.
  const { messages, total, warmupCount } = await listMessagesPage({
    uniboxId: id,
    accountId: accountFilter,
    showWarmup,
    limit: all ? 2000 : Math.min(limitParam, 2000),
    offset: all ? 0 : offset,
  });

  return NextResponse.json({
    messages,
    warmupCount,
    bounceCount: 0,
    total,
    has_more: !all && offset + messages.length < total,
  });
}

/**
 * DELETE /api/uniboxes/[id]/messages
 *   ?mode=all       Borra TODOS los mensajes del histórico (default)
 *   ?mode=bounces   Borra sólo los bounces / delivery failure
 *
 * Admin O cliente de la unibox. El próximo sync trae mensajes válidos desde IMAP.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "all";

  if (mode === "bounces") {
    const r = await purgeBounces(id);
    return NextResponse.json({ ok: true, mode: "bounces", ...r });
  }
  const r = await clearAllMessages(id);
  return NextResponse.json({ ok: true, mode: "all", ...r });
}
