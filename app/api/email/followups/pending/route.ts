import { NextResponse } from "next/server";
import { listThreads } from "@/lib/email-threads";

export const runtime = "nodejs";

/**
 * GET /api/email/followups/pending
 * Devuelve los follow-ups en estado "pending_approval" (esperando confirmación humana).
 */
export async function GET() {
  const threads = await listThreads();
  const items: any[] = [];
  for (const t of threads) {
    for (const f of t.followups) {
      if (f.status !== "pending_approval") continue;
      const prospect = t.participants.find((p) => !/onepulso\.online$/i.test(p)) || t.participants[0] || "";
      const lastInbound = [...t.messages].reverse().find((m) => m.direction === "inbound");
      items.push({
        id: f.id,
        thread_id: t.id,
        subject: t.subject,
        contact_email: prospect,
        contact_name: t.contact_name || prospect,
        body_html: f.body_html,
        scheduled_at: f.scheduled_at,
        origin: f.origin,
        last_inbound_excerpt: (lastInbound?.body_text || "").slice(0, 160),
        last_inbound_date: lastInbound?.date,
      });
    }
  }
  items.sort((a, b) => (b.scheduled_at || "").localeCompare(a.scheduled_at || ""));
  return NextResponse.json({ pending: items });
}
