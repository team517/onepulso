import { NextResponse } from "next/server";
import { listThreads } from "@/lib/email-threads";
import { readEmailConfig } from "@/lib/email-config";
import { startEmailScheduler, tick } from "@/lib/email-scheduler";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/email/followups/health
 * Diagnóstico exhaustivo del envío automático de follow-ups.
 * Devuelve estado del scheduler, todas las follow-ups por estado,
 * próximas a enviar, vencidas pendientes, fallidas recientes, etc.
 *
 * GET /api/email/followups/health?tick=1
 * Además fuerza un tick AHORA antes de responder (envía los vencidos).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const forceTick = url.searchParams.get("tick") === "1";

  const cfg = await readEmailConfig();

  // Asegurar scheduler arrancado
  startEmailScheduler();
  const schedulerAlive = !!(globalThis as any).__emailScheduler;

  let tickResult: any = null;
  if (forceTick) {
    try {
      tickResult = await tick();
    } catch (e: any) {
      tickResult = { error: e.message };
    }
  }

  const threads = await listThreads();
  const now = Date.now();
  const tenMinFromNow = now + 10 * 60 * 1000;
  const oneDayFromNow = now + 24 * 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  type Bucket = {
    count: number;
    items: Array<{
      thread_id: string;
      contact: string;
      followup_id: string;
      scheduled_at: string;
      sent_at?: string;
      origin: string;
      error?: string;
      body_preview: string;
    }>;
  };

  const overdue: Bucket = { count: 0, items: [] };          // status=scheduled, scheduled_at < now → bug si > 1 min
  const dueSoon: Bucket = { count: 0, items: [] };          // status=scheduled, scheduled_at < +10 min
  const upcoming24h: Bucket = { count: 0, items: [] };      // status=scheduled, scheduled_at < +24h
  const pendingApproval: Bucket = { count: 0, items: [] }; // status=pending_approval
  const sending: Bucket = { count: 0, items: [] };          // status=sending (no debería quedarse aquí > 1 min)
  const failed: Bucket = { count: 0, items: [] };           // status=failed
  const sentRecent: Bucket = { count: 0, items: [] };       // status=sent, sent_at < 24h ago
  let totalScheduled = 0;

  for (const t of threads) {
    const contact = t.participants.find((p) => p.toLowerCase() !== (cfg?.email?.toLowerCase() ?? "")) ?? t.participants[0] ?? "(sin contacto)";
    for (const f of t.followups ?? []) {
      const item = {
        thread_id: t.id,
        contact,
        followup_id: f.id,
        scheduled_at: f.scheduled_at,
        sent_at: f.sent_at,
        origin: f.origin,
        error: f.error,
        body_preview: stripHtml(f.body_html || "").slice(0, 120),
      };
      const sched = new Date(f.scheduled_at).getTime();
      if (f.status === "scheduled") {
        totalScheduled++;
        if (sched < now - 60_000) {
          overdue.count++; overdue.items.push(item);
        } else if (sched < tenMinFromNow) {
          dueSoon.count++; dueSoon.items.push(item);
        } else if (sched < oneDayFromNow) {
          upcoming24h.count++; upcoming24h.items.push(item);
        }
      } else if (f.status === "pending_approval") {
        pendingApproval.count++; pendingApproval.items.push(item);
      } else if (f.status === "sending") {
        sending.count++; sending.items.push(item);
      } else if (f.status === "failed") {
        failed.count++; failed.items.push(item);
      } else if (f.status === "sent" && f.sent_at && new Date(f.sent_at).getTime() > oneDayAgo) {
        sentRecent.count++; sentRecent.items.push(item);
      }
    }
  }

  // Sort items within each bucket by scheduled_at asc
  for (const b of [overdue, dueSoon, upcoming24h, sentRecent, failed, sending, pendingApproval]) {
    b.items.sort((a, c) => new Date(a.scheduled_at).getTime() - new Date(c.scheduled_at).getTime());
    b.items = b.items.slice(0, 10); // máx 10 por bucket
  }

  const diagnosis = buildDiagnosis({
    schedulerAlive,
    resendConfigured: !!cfg?.resend_api_key,
    emailConfigured: !!cfg,
    overdue,
    sending,
    failed,
    sentRecent,
    totalScheduled,
  });

  return NextResponse.json({
    checked_at: new Date().toISOString(),
    scheduler_alive: schedulerAlive,
    email_configured: !!cfg,
    resend_configured: !!cfg?.resend_api_key,
    send_via: cfg?.resend_api_key ? "resend" : "smtp",
    forced_tick: forceTick ? tickResult : undefined,
    counts: {
      total_scheduled: totalScheduled,
      overdue: overdue.count,
      due_soon_10min: dueSoon.count,
      upcoming_24h: upcoming24h.count,
      pending_approval: pendingApproval.count,
      sending: sending.count,
      failed: failed.count,
      sent_last_24h: sentRecent.count,
    },
    overdue: overdue.items,
    due_soon: dueSoon.items,
    upcoming_24h: upcoming24h.items,
    pending_approval: pendingApproval.items,
    sending: sending.items,
    failed: failed.items,
    sent_recent: sentRecent.items,
    diagnosis,
  });
}

function buildDiagnosis(s: {
  schedulerAlive: boolean;
  resendConfigured: boolean;
  emailConfigured: boolean;
  overdue: { count: number; items: any[] };
  sending: { count: number };
  failed: { count: number };
  sentRecent: { count: number };
  totalScheduled: number;
}): string {
  const parts: string[] = [];

  if (!s.emailConfigured) {
    parts.push("🚨 No hay cuenta de email conectada — no se puede enviar nada");
    return parts.join(" · ");
  }
  if (!s.resendConfigured) {
    parts.push("⚠️ Resend NO configurado — el envío directo a Gmail SMTP está bloqueado en Railway. Configura Resend.");
  } else {
    parts.push("✅ Resend configurado");
  }
  if (s.schedulerAlive) {
    parts.push("✅ Scheduler corriendo cada 30s");
  } else {
    parts.push("⚠️ Scheduler NO corriendo");
  }
  if (s.overdue.count > 0) {
    parts.push(`🚨 ${s.overdue.count} follow-up(s) VENCIDA(s) sin enviar — el scheduler debería haberlas mandado ya`);
  }
  if (s.sending.count > 0) {
    parts.push(`⏳ ${s.sending.count} en estado 'sending' — si llevan ahí más de 1 min, hubo un crash; reinicia el scheduler con /api/cron/tick`);
  }
  if (s.failed.count > 0) {
    parts.push(`❌ ${s.failed.count} fallida(s) — revisa los errores y reintenta desde la UI`);
  }
  if (s.sentRecent.count > 0) {
    parts.push(`✓ ${s.sentRecent.count} enviada(s) en las últimas 24h`);
  }
  if (s.totalScheduled === 0 && s.sentRecent.count === 0 && s.failed.count === 0) {
    parts.push("ℹ️ No hay follow-ups programados ni enviados recientemente — programa uno para probar");
  }
  return parts.join(" · ");
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
