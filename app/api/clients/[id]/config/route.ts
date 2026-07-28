import { NextRequest, NextResponse } from "next/server";
import { getReportConfig, saveReportConfig } from "@/lib/client-reports";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ config: await getReportConfig(id) });
}

/** POST → guarda la config del informe (destinatario, asunto, cuerpo, intro, activar 48h). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: any = {};
  for (const k of ["client_name", "recipient_email", "email_subject", "email_body_html", "pdf_intro", "enabled", "interval_hours", "campaign_ids", "context_unibox_id"]) {
    if (k in body) patch[k] = body[k];
  }
  const config = await saveReportConfig(id, patch);
  return NextResponse.json({ ok: true, config });
}
