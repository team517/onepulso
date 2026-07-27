import { NextRequest, NextResponse } from "next/server";
import { getReportConfig, buildReportForClient } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 90;

/** GET → genera el PDF del informe y lo devuelve (para previsualizar/descargar). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const cfg = await getReportConfig(id);
    const pdf = await buildReportForClient(id, cfg.client_name, cfg.pdf_intro);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="Informe-${cfg.client_name.replace(/[^\w\-]+/g, "_")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
