import { NextRequest, NextResponse } from "next/server";
import { getReportConfig, buildReportForClient } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 90;

/** GET → genera el PDF del informe y lo devuelve (para previsualizar/descargar). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const download = new URL(req.url).searchParams.get("download") === "1";
  try {
    const cfg = await getReportConfig(id);
    const pdf = await buildReportForClient(id, cfg.client_name, cfg.pdf_intro);
    const fname = `Informe-${cfg.client_name.replace(/[^\w\-]+/g, "_")}.pdf`;
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
