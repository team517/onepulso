/**
 * Auth del portal de CLIENTE (multi-tenant).
 * Sesión HMAC firmada (mismo patrón que unibox-auth), cookie `client_session`
 * con payload { clientId, email, iat }. Distinta del cookie del owner
 * (onepulso_session) y del unibox (unibox_session).
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { runWithTenant } from "./tenant";

export const CLIENT_COOKIE = "client_session";
const SECRET = process.env.AUTH_SECRET || "onepulso-xarifa-2026-session";

export type ClientSession = {
  clientId: string;
  email: string;
  iat: number;
};

export function signClientSession(s: ClientSession): string {
  const payload = Buffer.from(JSON.stringify(s)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyClientSession(token: string | undefined | null): ClientSession | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8")) as ClientSession;
    if (Date.now() - obj.iat > 30 * 24 * 60 * 60 * 1000) return null; // 30 días
    return obj;
  } catch {
    return null;
  }
}

export function setClientCookie(res: NextResponse, session: ClientSession, isHttps: boolean): void {
  res.cookies.set({
    name: CLIENT_COOKIE,
    value: signClientSession(session),
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60,
    path: "/",
  });
}

export function clearClientCookie(res: NextResponse): void {
  res.cookies.set({ name: CLIENT_COOKIE, value: "", maxAge: 0, path: "/" });
}

/** Devuelve la sesión de cliente del request (o null). Verificación síncrona (HMAC). */
export function getClientSession(req: NextRequest): ClientSession | null {
  const c = req.cookies.get(CLIENT_COOKIE);
  return verifyClientSession(c?.value);
}

/** clientId del request si hay sesión de cliente válida, si no null (= owner). */
export function clientIdFromRequest(req: NextRequest): string | null {
  return getClientSession(req)?.clientId ?? null;
}

/** ¿El request lleva la cookie del owner (onepulso_session) válida? */
export function isOwner(req: NextRequest): boolean {
  const c = req.cookies.get("onepulso_session");
  return !!c && c.value === SECRET;
}

/**
 * Ejecuta el handler dentro del contexto de tenant que corresponda al request:
 * cliente → sus claves namespaceadas; owner → claves globales. TODAS las rutas
 * de /api/email/* y /api/personalization/* deben envolverse con esto.
 *
 * SEGURIDAD: si la cookie de cliente está PRESENTE pero es inválida (firma
 * falsa/caducada) y no hay cookie de owner → 401. Nunca caemos a las claves
 * del owner por una cookie de cliente falsificada.
 */
export function withRequestTenant<T>(
  req: NextRequest,
  fn: () => Promise<T>
): Promise<T | NextResponse> {
  // Owner (onepulso_session válido) → claves globales.
  if (isOwner(req)) return runWithTenant(null, fn);
  // Cliente: la cookie debe existir y verificar.
  const raw = req.cookies.get(CLIENT_COOKIE);
  const session = verifyClientSession(raw?.value);
  if (session) return runWithTenant(session.clientId, fn);
  return Promise.resolve(
    NextResponse.json({ error: "No autorizado" }, { status: 401 })
  );
}
