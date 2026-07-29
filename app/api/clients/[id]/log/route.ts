import { NextResponse } from "next/server";
import { getReportLog } from "@/lib/client-reports";

export const runtime = "nodejs";

/** GET → historial de informes enviados de un cliente (más reciente primero). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const log = await getReportLog(id).catch(() => []);
  return NextResponse.json({ log });
}
