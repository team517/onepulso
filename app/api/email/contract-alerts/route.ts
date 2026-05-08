import { NextResponse } from "next/server";
import { listThreads } from "@/lib/email-threads";

export const runtime = "nodejs";

/**
 * GET /api/email/contract-alerts
 * Devuelve los threads con contract_alert pendiente (no acknowledged).
 */
export async function GET() {
  const threads = await listThreads();
  const alerts = threads
    .filter(t => t.contract_alert && !t.contract_alert.acknowledged)
    .map(t => {
      const prospect = t.participants.find(p => !/onepulso\.online$/i.test(p)) || t.participants[0] || "";
      return {
        thread_id: t.id,
        subject: t.subject,
        contact_email: prospect,
        contact_name: t.contact_name || prospect,
        excerpt: t.contract_alert!.excerpt,
        detected_at: t.contract_alert!.detected_at,
      };
    })
    .sort((a, b) => b.detected_at.localeCompare(a.detected_at));

  return NextResponse.json({ alerts });
}
