import { NextRequest, NextResponse } from "next/server";
import { deleteAccount, listAccounts, saveAccounts } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id, accountId } = await params;
  await deleteAccount(id, accountId);
  return NextResponse.json({ ok: true });
}

/**
 * PATCH /api/uniboxes/[id]/accounts/[accountId]
 * Actualiza campos editables de una cuenta. Hoy solo signature_html
 * (más adelante: nombre, daily_limit, etc.). Acepta tanto admin como
 * el cliente dueño de la unibox.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  const { id, accountId } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const accs = await listAccounts(id);
  const idx = accs.findIndex((a) => a.id === accountId);
  if (idx === -1) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });

  // Sólo campos editables — nunca permitir cambiar credenciales por aquí.
  if (typeof body.signature_html === "string") {
    accs[idx].signature_html = body.signature_html.slice(0, 5000); // cap 5KB
  }
  if (typeof body.first_name === "string") accs[idx].first_name = body.first_name.slice(0, 80);
  if (typeof body.last_name === "string") accs[idx].last_name = body.last_name.slice(0, 80);

  await saveAccounts(id, accs);
  const { imap_pass, smtp_pass, ...safe } = accs[idx];
  return NextResponse.json({ account: safe });
}
