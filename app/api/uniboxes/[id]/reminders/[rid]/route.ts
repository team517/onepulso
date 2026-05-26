import { NextRequest, NextResponse } from "next/server";
import { updateReminder, deleteReminder } from "@/lib/unibox-reminders";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const updated = await updateReminder(id, rid, body);
  if (!updated) return NextResponse.json({ error: "Reminder no encontrado" }, { status: 404 });
  return NextResponse.json({ reminder: updated });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  await deleteReminder(id, rid);
  return NextResponse.json({ ok: true });
}
