import { NextRequest, NextResponse } from "next/server";

const AUTH_EMAIL = process.env.AUTH_EMAIL || "team@onepulso.online";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "Xarifa229%";
const SESSION_TOKEN = process.env.AUTH_SECRET || "onepulso-xarifa-2026-session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const remember = Math.max(1, Math.min(365, Number(body.remember) || 7));

    const expectedEmail = AUTH_EMAIL.toLowerCase().trim();

    if (email !== expectedEmail) {
      return NextResponse.json({ error: "Email o contraseña incorrectos" }, { status: 401 });
    }
    if (password !== AUTH_PASSWORD) {
      return NextResponse.json({ error: "Email o contraseña incorrectos" }, { status: 401 });
    }

    // Detectar si la request viene por HTTPS (producción)
    const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
    const isHttps = proto === "https";

    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: "onepulso_session",
      value: SESSION_TOKEN,
      httpOnly: true,
      secure: isHttps,           // true en Railway, false en localhost
      sameSite: "lax",
      maxAge: remember * 24 * 60 * 60,
      path: "/",
    });

    return res;
  } catch (e: any) {
    console.error("[auth/login] error:", e);
    return NextResponse.json({ error: e.message || "Error del servidor" }, { status: 500 });
  }
}
