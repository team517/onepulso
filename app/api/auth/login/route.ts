import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac } from "crypto";

const AUTH_EMAIL = process.env.AUTH_EMAIL || "team@onepulso.online";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "onepulso2026";
const SECRET = process.env.AUTH_SECRET || "onepulso-secret-2026";

function createToken(days: number): string {
  const expires = Date.now() + days * 24 * 60 * 60 * 1000;
  const data = `${AUTH_EMAIL}:${expires}`;
  const sig = createHmac("sha256", SECRET).update(data).digest("hex");
  return Buffer.from(`${data}:${sig}`).toString("base64");
}

export async function POST(req: NextRequest) {
  const { email, password, remember = 7 } = await req.json();

  if (email !== AUTH_EMAIL || password !== AUTH_PASSWORD) {
    return NextResponse.json({ error: "Email o contraseña incorrectos" }, { status: 401 });
  }

  const token = createToken(remember);
  const cookieStore = await cookies();
  cookieStore.set("onepulso_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: remember * 24 * 60 * 60,
    path: "/",
  });

  return NextResponse.json({ ok: true });
}
