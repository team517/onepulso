import { NextRequest, NextResponse } from "next/server";
import { listThreads, updateFollowup, appendMessage, getThread } from "@/lib/email-threads";
import { sendEmail } from "@/lib/email-send";
import { readEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/email/followups/:id/approve
 * Body: { body_html?: string, scheduled_at?: string, send_now?: boolean }
 *
 * Si send_now=true → envía INMEDIATAMENTE por SMTP y marca como "sent".
 * Si send_now=false → status="scheduled" con scheduled_at=lo indicado, scheduler lo envía a su hora.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  // Localizar thread del followup
  const threads = await listThreads();
  let threadId: string | null = null;
  for (const t of threads) {
    if (t.followups.some((f) => f.id === id)) { threadId = t.id; break; }
  }
  if (!threadId) return NextResponse.json({ error: "Follow-up no encontrado" }, { status: 404 });

  const thread = await getThread(threadId);
  if (!thread) return NextResponse.json({ error: "Thread no encontrado" }, { status: 404 });
  const followup = thread.followups.find((f) => f.id === id);
  if (!followup) return NextResponse.json({ error: "Follow-up no encontrado" }, { status: 404 });

  // Posible body editado
  const bodyHtml = typeof body.body_html === "string" && body.body_html.trim()
    ? body.body_html
    : followup.body_html;

  // ENVÍO INMEDIATO
  if (body.send_now === true) {
    const cfg = await readEmailConfig();
    if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

    await updateFollowup(threadId, id, { status: "sending", body_html: bodyHtml });

    try {
      // Reply al ÚLTIMO mensaje del hilo (cualquier dirección)
      const lastMsg = thread.messages[thread.messages.length - 1];
      const recipient =
        thread.participants.find((p) => p.toLowerCase() !== cfg.email.toLowerCase()) ??
        thread.participants[0];

      const baseSubject = thread.subject.replace(/^(re:\s*)+/i, "").trim();
      const subject = `Re: ${baseSubject}`;

      const refsChain: string[] = [];
      if (lastMsg?.references) refsChain.push(...lastMsg.references);
      if (lastMsg?.in_reply_to && !refsChain.includes(lastMsg.in_reply_to)) refsChain.push(lastMsg.in_reply_to);
      if (lastMsg?.message_id && !refsChain.includes(lastMsg.message_id)) refsChain.push(lastMsg.message_id);

      const info = await sendEmail({
        to: recipient,
        subject,
        body_html: bodyHtml,
        in_reply_to: lastMsg?.message_id,
        references: refsChain.length > 0 ? refsChain : undefined,
      });

      await appendMessage(threadId, {
        direction: "outbound",
        from: cfg.email,
        to: [recipient],
        subject,
        body_html: bodyHtml,
        message_id: info.messageId,
        in_reply_to: lastMsg?.message_id,
        references: refsChain.length > 0 ? refsChain : undefined,
        date: new Date().toISOString(),
      });

      await updateFollowup(threadId, id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_message_id: info.messageId,
      });

      return NextResponse.json({
        ok: true,
        sent_to: recipient,
        message_id: info.messageId,
      });
    } catch (e: any) {
      await updateFollowup(threadId, id, { status: "failed", error: e.message });
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  // PROGRAMADO (no inmediato)
  const patch: any = { status: "scheduled", body_html: bodyHtml };
  if (typeof body.scheduled_at === "string") patch.scheduled_at = body.scheduled_at;
  const result = await updateFollowup(threadId, id, patch);
  return NextResponse.json({ ok: true, followup: result });
}

/** DELETE → cancela el borrador */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const threads = await listThreads();
  let threadId: string | null = null;
  for (const t of threads) {
    if (t.followups.some((f) => f.id === id)) { threadId = t.id; break; }
  }
  if (!threadId) return NextResponse.json({ error: "Follow-up no encontrado" }, { status: 404 });
  await updateFollowup(threadId, id, { status: "cancelled" });
  return NextResponse.json({ ok: true });
}
