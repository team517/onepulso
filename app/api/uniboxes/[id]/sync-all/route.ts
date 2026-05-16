import { NextRequest, NextResponse } from "next/server";
import { syncUnibox } from "@/lib/unibox-sync";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/uniboxes/[id]/sync-all
 * Sincroniza TODAS las cuentas IMAP de esta unibox (INBOX + Sent).
 * Versión no-streaming: hace todo el trabajo y devuelve el resumen.
 * Permite tanto al admin como al cliente de la unibox.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const r = await syncUnibox(id);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
