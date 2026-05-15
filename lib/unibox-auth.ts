/**
 * Auth de cliente para unibox. Cada unibox tiene credenciales propias
 * (client_email + client_password) y una cookie de sesión específica.
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getUnibox } from "./unibox-store";

const COOKIE_NAME = "unibox_session";
const SECRET = process.env.AUTH_SECRET || "onepulso-xarifa-2026-session";

export type UniboxSession = {
  uniboxId: string;
  clientEmail: string;
  iat: number;
};

/** Firma un token HMAC: base64(payload).hmac */
export function signSession(s: UniboxSession): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySession(token: string): UniboxSession | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as UniboxSession;
    // expire after 30 days
    if (Date.now() - obj.iat > 30 * 24 * 60 * 60 * 1000) return null;
    return obj;
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, session: UniboxSession, isHttps: boolean): void {
  const token = signSession(session);
  res.cookies.set({
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set({ name: COOKIE_NAME, value: "", maxAge: 0, path: "/" });
}

export function getSessionFromRequest(req: NextRequest): UniboxSession | null {
  const c = req.cookies.get(COOKIE_NAME);
  if (!c) return null;
  return verifySession(c.value);
}

/** Verifica que la sesión es válida Y corresponde a esa unibox. */
export async function requireClientForUnibox(req: NextRequest, uniboxId: string): Promise<UniboxSession | null> {
  const session = getSessionFromRequest(req);
  if (!session || session.uniboxId !== uniboxId) return null;
  const u = await getUnibox(uniboxId);
  if (!u || u.client_email !== session.clientEmail) return null;
  return session;
}

/** Verifica que la sesión admin está presente (cookie onepulso_session). */
export function requireAdmin(req: NextRequest): boolean {
  const c = req.cookies.get("onepulso_session");
  const expected = process.env.AUTH_SECRET || "onepulso-xarifa-2026-session";
  return !!c && c.value === expected;
}
