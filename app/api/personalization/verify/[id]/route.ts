import { NextResponse } from "next/server";
import { getVerifyJob } from "@/lib/verify-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/personalization/verify/[id] — estado/progreso/resultado del trabajo. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = getVerifyJob(id);
  if (!job) return NextResponse.json({ error: "Trabajo no encontrado (puede haber expirado o reiniciado el servidor)" }, { status: 404 });
  return NextResponse.json(job);
}
