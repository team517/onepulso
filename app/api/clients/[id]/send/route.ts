import { NextRequest, NextResponse } from "next/server";
import { sendReportForClient } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST → genera y ENVÍA el informe por email al destinatario configurado. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const testEmail = String(body?.test_email ?? "").trim();
  // URL pública real para el enlace del PDF: detrás del proxy de EasyPanel el
  // origin interno es "localhost:80"; usamos el host REENVIADO por el proxy.
  const h = req.headers;
  const fwdHost = h.get("x-forwarded-host") || h.get("host") || "";
  const fwdProto = h.get("x-forwarded-proto") || "https";
  const baseUrl = fwdHost && !/^(localhost|127\.|0\.0\.0\.0)/.test(fwdHost) ? `${fwdProto}://${fwdHost}` : undefined;
  try {
    const r = testEmail
      ? await sendReportForClient(id, { overrideEmail: testEmail, test: true, baseUrl })
      : await sendReportForClient(id, { baseUrl });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
