import { NextRequest, NextResponse } from "next/server";
import { authenticate } from "@/lib/client-accounts";
import { setClientCookie } from "@/lib/client-auth";

export const runtime = "nodejs";

/** POST /api/client-portal/login  Body: { email, password } */
export async function POST(req: NextRequest) {
  const { email, password } = await req.json().catch(() => ({}));
  if (!email || !password) {
    return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
  }
  const account = await authenticate(String(email), String(password));
  if (!account) {
    return NextResponse.json({ error: "Credenciales incorrectas o cuenta desactivada" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, email: account.email, name: account.name ?? null });
  const isHttps = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  setClientCookie(res, { clientId: account.id, email: account.email, iat: Date.now() }, isHttps);
  return res;
}
