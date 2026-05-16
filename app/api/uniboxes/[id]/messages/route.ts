import { NextRequest, NextResponse } from "next/server";
import { getUnibox, loadMessagesMap, clearAllMessages, purgeBounces, isBounceOrFailure } from "@/lib/unibox-store";
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
  // El cliente puede pedir ?show_bounces=1 para ver los rebotes (debug); por defecto se ocultan.
  // El admin SIEMPRE los ve a menos que indique lo contrario.
  const showBounces = url.searchParams.get("show_bounces") === "1";
  const filterBounces = !showBounces; // ocultar bounces por defecto en TODAS las vistas

  const map = await loadMessagesMap(id);
  const out: any[] = [];
  let warmupCount = 0;
  let bounceCount = 0;
  for (const accId of Object.keys(map)) {
    if (accountFilter && accountFilter !== accId) continue;
    for (const m of map[accId]) {
      if (m.is_warmup) {
        warmupCount++;
        if (!showWarmup) continue;
      }
      // Filtrar bounces / delivery failures (en caso de que se hayan colado antes
      // de habilitarse el filtro en el sync). Doble red de seguridad.
      if (filterBounces && isBounceOrFailure(m)) {
        bounceCount++;
        continue;
      }
      const { text, html, ...rest } = m;
      out.push({ ...rest, accountId: accId });
    }
  }
  out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return NextResponse.json({ messages: out.slice(0, 500), warmupCount, bounceCount });
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
