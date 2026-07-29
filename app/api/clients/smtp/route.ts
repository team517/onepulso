import { NextRequest, NextResponse } from "next/server";
import { getReportSmtp, saveReportSmtp, testReportSmtp } from "@/lib/report-smtp";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET → estado de la cuenta SMTP de informes (sin exponer la contraseña). */
export async function GET() {
  const s = await getReportSmtp();
  const connected = !!(s.host && s.user && s.pass);
  return NextResponse.json({
    connected,
    host: s.host || "",
    port: s.port || 587,
    user: s.user || "",
    from_email: s.from_email || "",
    from_name: s.from_name || "",
    has_pass: !!s.pass,
  });
}

/** POST → guarda la config SMTP y verifica la conexión (login).
 *  Body: { host, port, user, pass, from_email, from_name }.
 *  Si `pass` viene vacío se conserva la contraseña ya guardada. */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const patch = {
    host: String(b.host || "").trim(),
    port: Number(b.port) || 587,
    user: String(b.user || "").trim(),
    pass: typeof b.pass === "string" ? b.pass : "",
    from_email: String(b.from_email || "").trim(),
    from_name: String(b.from_name || "").trim(),
  };
  if (!patch.host || !patch.user) {
    return NextResponse.json({ ok: false, error: "Faltan host o usuario." }, { status: 400 });
  }
  const saved = await saveReportSmtp(patch);
  const verify = await testReportSmtp(saved);
  return NextResponse.json({
    ok: verify.ok,
    error: verify.ok ? undefined : verify.error,
    connected: !!(saved.host && saved.user && saved.pass),
    from_email: saved.from_email || saved.user || "",
  });
}
