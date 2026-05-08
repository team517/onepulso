import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const AUTH_EMAIL = process.env.AUTH_EMAIL || "team@onepulso.online";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "Xarifa229%";
const SESSION_TOKEN = process.env.AUTH_SECRET || "onepulso-xarifa-2026-session";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email, password, remember = 7 } = body;

    const emailMatch = (email || "").toLowerCase().trim() === AUTH_EMAIL.toLowerCase().trim();
    const passMatch = (password || "") === AUTH_PASSWORD;

    if (!emailMatch || !passMatch) {
      return NextResponse.json({ error: "Email o contraseña incorrectos" }, { status: 401 });
    }

    const cookieStore = await cookies();
    cookieStore.set("onepulso_session", SESSION_TOKEN, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: Number(remember) * 24 * 60 * 60,
      path: "/",
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
