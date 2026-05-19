import { NextRequest, NextResponse } from "next/server";
import { getClientBySlug } from "@/lib/onboarding";

/**
 * Login del portal cliente onboarding.
 * Setea cookie `onboarding_client_<slug>` con el id del cliente.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").toLowerCase().trim();
  const username = String(body.username || "").trim();
  const password = String(body.password || "").trim();

  if (!slug || !username || !password) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const client = await getClientBySlug(slug);
  if (!client) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }
  if (
    client.username.toLowerCase() !== username.toLowerCase() ||
    client.password !== password
  ) {
    return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
  }

  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const isHttps = proto === "https";

  const res = NextResponse.json({ ok: true, client_id: client.id });
  res.cookies.set({
    name: `onboarding_client_${slug}`,
    value: client.id,
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 días
    path: "/",
  });
  return res;
}
