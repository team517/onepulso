import { NextRequest, NextResponse } from "next/server";
import { sendReportForClient } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST → genera y ENVÍA el informe por email al destinatario configurado. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const r = await sendReportForClient(id);
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
