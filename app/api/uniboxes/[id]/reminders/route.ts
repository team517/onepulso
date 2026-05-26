import { NextRequest, NextResponse } from "next/server";
import { listReminders, createReminder } from "@/lib/unibox-reminders";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const reminders = await listReminders(id);
  return NextResponse.json({ reminders });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const {
    account_id,
    recipient,
    original_subject,
    original_message_id,
    original_references,
    reminder_body,
    delay_hours,
  } = body;
  if (!account_id || !recipient || !original_message_id) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }
  const hours = Number(delay_hours);
  if (!hours || hours <= 0 || hours > 30 * 24) {
    return NextResponse.json({ error: "delay_hours inválido (1-720)" }, { status: 400 });
  }

  const reminder = await createReminder({
    unibox_id: id,
    account_id,
    recipient,
    original_subject: original_subject || "(sin asunto)",
    original_message_id,
    original_references: Array.isArray(original_references) ? original_references : [],
    reminder_body,
    delay_hours: hours,
  });
  return NextResponse.json({ reminder });
}
