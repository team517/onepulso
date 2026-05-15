import { NextRequest, NextResponse } from "next/server";
import { findUniboxByClientEmail, getUnibox, verifyPassword } from "@/lib/unibox-store";
import { setSessionCookie } from "@/lib/unibox-auth";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const password = String(body.password || "").trim();
  const uniboxId = String(body.uniboxId || "").trim();

  if (!email || !password) {
    return NextResponse.json({ error: "Email y contraseña requeridos" }, { status: 400 });
  }

  // If a uniboxId is provided (login from /u/[id]/login), verify it matches.
  let unibox = uniboxId ? await getUnibox(uniboxId) : null;
  if (!unibox) unibox = await findUniboxByClientEmail(email);
  if (!unibox || unibox.client_email !== email) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }
  if (!verifyPassword(password, unibox.client_password, unibox.client_password_salt)) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const isHttps = proto === "https";
  const res = NextResponse.json({ ok: true, uniboxId: unibox.id, title: unibox.title });
  setSessionCookie(res, { uniboxId: unibox.id, clientEmail: unibox.client_email, iat: Date.now() }, isHttps);
  return res;
}
