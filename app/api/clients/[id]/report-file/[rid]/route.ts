import { NextRequest, NextResponse } from "next/server";
import { getReportPdfBlob } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Descarga PÚBLICA del informe PDF por enlace (capability URL con id aleatorio).
 * No requiere login: el `rid` (UUID) es el que da acceso, como los enlaces
 * "compartir" de otras apps. Se envía en el correo al cliente.
 *   GET /api/clients/{id}/report-file/{rid}          → inline (ver en el navegador)
 *   GET /api/clients/{id}/report-file/{rid}?dl=1     → descarga con nombre de archivo
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; rid: string }> }) {
  const { id, rid } = await params;
  const blob = await getReportPdfBlob(id, rid);
  if (!blob) return new NextResponse("Informe no encontrado o caducado.", { status: 404 });

  const dl = new URL(req.url).searchParams.get("dl") === "1";
  const disp = dl ? "attachment" : "inline";
  return new NextResponse(blob.data as any, {
    headers: {
      "Content-Type": blob.mime || "application/pdf",
      "Content-Disposition": `${disp}; filename="Informe-OnePulso.pdf"`,
      "Content-Length": String(blob.data.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
