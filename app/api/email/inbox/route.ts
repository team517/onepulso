import { NextResponse } from "next/server";
import { listThreads } from "@/lib/email-threads";

export const runtime = "nodejs";

/**
 * GET /api/email/inbox
 *   ?days=30   — sólo respuestas de los últimos N días (default 30)
 *   ?unread=1  — sólo las que aún no han sido contestadas por el usuario
 *
 * Devuelve un array plano de mensajes INBOUND ordenado por fecha (más recientes primero).
 * Cada item incluye el hilo al que pertenece para poder linkar.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") || "30", 10);
  const unreadOnly = url.searchParams.get("unread") === "1";

  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const threads = await listThreads();

  type InboxItem = {
    message_id: string;
    thread_id: string;
    thread_subject: string;
    thread_status: string;
    contact_email: string;
    contact_name: string;
    from: string;
    subject: string;
    preview: string;
    date: string;
    is_unread: boolean; // true = no hemos respondido aún después de este inbound
    body_html?: string;
  };

  const items: InboxItem[] = [];
  for (const t of threads) {
    if (t.status === "closed") continue;

    const lastOutboundDate = (() => {
      const lastOut = [...t.messages].reverse().find((m) => m.direction === "outbound");
      return lastOut ? new Date(lastOut.date).getTime() : 0;
    })();

    for (const m of t.messages) {
      if (m.direction !== "inbound") continue;
      const ts = new Date(m.date).getTime();
      if (ts < since) continue;

      // is_unread: no hay outbound posterior a este inbound (el usuario aún no respondió)
      const isUnread = ts > lastOutboundDate;
      if (unreadOnly && !isUnread) continue;

      const previewSrc = m.body_text || stripHtml(m.body_html || "");
      const preview = previewSrc.slice(0, 200).replace(/\s+/g, " ").trim();

      items.push({
        message_id: m.message_id || `${t.id}-${ts}`,
        thread_id: t.id,
        thread_subject: t.subject,
        thread_status: t.status,
        contact_email: t.contact_email || m.from,
        contact_name: t.contact_name || m.from.split("@")[0],
        from: m.from,
        subject: m.subject || t.subject,
        preview,
        date: m.date,
        is_unread: isUnread,
        body_html: m.body_html,
      });
    }
  }

  items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const unread_count = items.filter((i) => i.is_unread).length;

  return NextResponse.json({
    items,
    total: items.length,
    unread_count,
    days,
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
