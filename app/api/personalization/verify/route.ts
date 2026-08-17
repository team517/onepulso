import { withRequestTenant } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { createVerifyJob, runVerifyJob } from "@/lib/verify-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/personalization/verify
 * Body: { file_id, email_column, filename?, smtp? }
 * Lanza la verificación EN SEGUNDO PLANO y devuelve { job_id } al instante.
 * El cliente consulta el progreso en GET /api/personalization/verify/[id].
 */
export async function POST(req: Request) {
  return withRequestTenant(req as any, async () => {
  const body = await req.json().catch(() => ({}));
  const { file_id, email_column, filename, smtp } = body;
  if (!file_id || !email_column) {
    return NextResponse.json({ error: "file_id y email_column requeridos" }, { status: 400 });
  }
  const job = createVerifyJob();
  // Background: NO await (igual que personalization runJob). El proceso de
  // Railway sigue vivo y termina el trabajo aunque la petición ya respondió.
  runVerifyJob(job.id, {
    file_id,
    emailColumn: email_column,
    filename: filename || "leads",
    smtp: smtp !== false,
  }).catch((e) => console.error(`[verify] job ${job.id} fatal:`, e?.message || e));

  return NextResponse.json({ job_id: job.id });

  }) as any;
}
