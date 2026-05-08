import { NextResponse } from "next/server";
import { listThreads, updateFollowup, appendMessage, getThread } from "@/lib/email-threads";
import { sendEmail } from "@/lib/email-send";
import { readEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/email/followups/:id/send-now
 * Envía inmediatamente un follow-up programado, antes de su fecha.
 * El parámetro :id es el followupId.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  try {
    // Buscar el thread y followup
    const threads = await listThreads();
    let thread: any = null;
    let followup: any = null;
    for (const t of threads) {
      const f = t.followups.find((f) => f.id === id);
      if (f) {
        thread = t;
        followup = f;
        break;
      }
    }

    if (!thread || !followup) {
      return NextResponse.json({ error: "Follow-up no encontrado" }, { status: 404 });
    }

    if (followup.status !== "scheduled") {
      return NextResponse.json(
        { error: `No se puede enviar (estado: ${followup.status})` },
        { status: 400 }
      );
    }

    const cfg = await readEmailConfig();
    if (!cfg) {
      return NextResponse.json({ error: "Email no conectado" }, { status: 400 });
    }

    await updateFollowup(thread.id, followup.id, { status: "sending" });

    // Reply al ÚLTIMO mensaje del hilo (sea inbound u outbound),
    // para que aparezca como continuación natural de la conversación.
    const lastMsg = thread.messages[thread.messages.length - 1];
    const refMsg = lastMsg;
    const recipient =
      thread.participants.find((p: string) => p.toLowerCase() !== cfg.email.toLowerCase()) ??
      thread.participants[0];

    // Asegurar prefijo "Re:" sin duplicarlo
    const baseSubject = thread.subject.replace(/^(re:\s*)+/i, "").trim();
    const subject = `Re: ${baseSubject}`;
    const cleanBody = followup.body_html.replace(/<!--\s*if[\s\S]*?-->/gi, "").trim();

    // Construir cadena de References: todas las references del último msg + su message_id
    const refsChain: string[] = [];
    if (refMsg?.references) refsChain.push(...refMsg.references);
    if (refMsg?.in_reply_to && !refsChain.includes(refMsg.in_reply_to)) {
      refsChain.push(refMsg.in_reply_to);
    }
    if (refMsg?.message_id && !refsChain.includes(refMsg.message_id)) {
      refsChain.push(refMsg.message_id);
    }

    try {
      const info = await sendEmail({
        to: recipient,
        subject,
        body_html: cleanBody,
        in_reply_to: refMsg?.message_id,
        references: refsChain.length > 0 ? refsChain : undefined,
      });

      await appendMessage(thread.id, {
        direction: "outbound",
        from: cfg.email,
        to: [recipient],
        subject,
        body_html: cleanBody,
        message_id: info.messageId,
        in_reply_to: refMsg?.message_id,
        references: refsChain.length > 0 ? refsChain : undefined,
        date: new Date().toISOString(),
      });

      await updateFollowup(thread.id, followup.id, {
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
      await updateFollowup(thread.id, followup.id, { status: "failed", error: e.message });
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
