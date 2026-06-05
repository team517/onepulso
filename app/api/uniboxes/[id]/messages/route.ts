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

  // Paginación opcional: ?limit=N (default 5000), ?offset=N (default 0).
  // Si el cliente pide ?limit=0 o ?all=1, devolvemos TODOS sin tope.
  const limitParam = parseInt(url.searchParams.get("limit") || "5000", 10);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const all = url.searchParams.get("all") === "1" || limitParam === 0;

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
      // PERFORMANCE: enviamos SOLO los campos necesarios para el listado.
      // text/html quedan en backend (se piden bajo demanda al abrir el msg
      // via /messages/[accountId]/[uid]). Antes mandar 5000 previews de
      // 180 chars + subject + from era ~500KB-1MB. Ahora ~200KB.
      out.push({
        uid: m.uid,
        accountId: accId,
        messageId: m.messageId,
        from: m.from,
        fromName: m.fromName,
        fromAddress: m.fromAddress,
        to: m.to,
        toAddress: m.toAddress,
        subject: m.subject,
        date: m.date,
        preview: m.preview,
        unread: m.unread,
        is_warmup: m.is_warmup,
        folder_id: (m as any).folder_id || null,
        has_attachments: (m.attachments?.length || 0) > 0,
      });
    }
  }
  out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const totalAvailable = out.length;
  // PERFORMANCE: aunque el cliente pida ?all=1, capamos a 1500 mensajes
  // ordenados por fecha. Es lo que cabe razonablemente en el listado.
  // El usuario raramente baja de 1500 al scrollear. Si necesita más,
  // puede paginar con offset.
  const HARD_CAP = 1500;
  const sliced = all
    ? out.slice(0, HARD_CAP)
    : out.slice(offset, offset + Math.min(limitParam, HARD_CAP));
  return NextResponse.json({
    messages: sliced,
    warmupCount,
    bounceCount,
    total: totalAvailable,
    has_more: !all && offset + sliced.length < totalAvailable,
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
