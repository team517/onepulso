import { NextRequest, NextResponse } from "next/server";
import { sendReportForClient } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 120;

/** POST → genera y ENVÍA el informe por email al destinatario configurado. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const testEmail = String(body?.test_email ?? "").trim();
  const baseUrl = req.nextUrl.origin; // para construir el enlace público del PDF
  try {
    const r = testEmail
      ? await sendReportForClient(id, { overrideEmail: testEmail, test: true, baseUrl })
      : await sendReportForClient(id, { baseUrl });
    return NextResponse.json(r);
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
