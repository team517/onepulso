import type { NextRequest } from "next/server";
import { withRequestTenant } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { listThreadsLight } from "@/lib/email-threads";
import { readEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";

/**
 * GET /api/email/followups/pending
 * Devuelve los follow-ups en estado "pending_approval" (esperando confirmación humana).
 */
export async function GET(req: NextRequest) {
  return withRequestTenant(req as any, async () => {
  const threads = await listThreadsLight();
  const cfg = await readEmailConfig().catch(() => null);
  const ourEmail = (cfg?.email || "").toLowerCase();
  const items: any[] = [];
  for (const t of threads) {
    for (const f of t.followups) {
      if (f.status !== "pending_approval") continue;
      // El prospect es el participante que NO es nuestra cuenta conectada.
      const prospect =
        t.participants.find((p) => ourEmail && p.toLowerCase() !== ourEmail) ||
        t.participants[0] ||
        "";
      const lastInbound = t.last_message?.direction === "inbound" ? t.last_message : undefined;
      items.push({
        id: f.id,
        thread_id: t.id,
        subject: t.subject,
        contact_email: prospect,
        contact_name: t.contact_name || prospect,
        body_html: f.body_html,
        scheduled_at: f.scheduled_at,
        origin: f.origin,
        last_inbound_excerpt: (lastInbound?.preview || "").slice(0, 160),
        last_inbound_date: lastInbound?.date,
      });
    }
  }
  items.sort((a, b) => (b.scheduled_at || "").localeCompare(a.scheduled_at || ""));
  return NextResponse.json({ pending: items });

  }) as any;
}
