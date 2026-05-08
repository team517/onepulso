import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SECRET = process.env.AUTH_SECRET || "onepulso-secret-2026";
const AUTH_EMAIL = process.env.AUTH_EMAIL || "team@onepulso.online";

function verifyToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parts = decoded.split(":");
    if (parts.length < 3) return false;
    const sig = parts.pop()!;
    const expires = parseInt(parts[parts.length - 1]);
    if (Date.now() > expires) return false;
    const data = parts.join(":");
    const expected = createHmac("sha256", SECRET).update(data).digest("hex");
    return sig === expected;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rutas públicas
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("onepulso_session")?.value;

  if (!token || !verifyToken(token)) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
