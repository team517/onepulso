import { NextRequest, NextResponse } from "next/server";
import { getClient, getClientBySlug } from "@/lib/onboarding";
import { findUniboxByClientEmail } from "@/lib/unibox-store";
import { setSessionCookie } from "@/lib/unibox-auth";

/**
 * Single Sign-On: si el cliente está autenticado en el portal /o/[slug]
 * y existe un Unibox cuyo client_email coincide con el `email` del cliente,
 * setea la cookie de sesión de unibox y devuelve el uniboxId para redirigir.
 *
 * Body: { slug: string }
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").toLowerCase().trim();
  if (!slug) return NextResponse.json({ error: "slug requerido" }, { status: 400 });

  // Verificar cookie de onboarding
  const cookieName = `onboarding_client_${slug}`;
  const cookieValue = req.cookies.get(cookieName)?.value;
  if (!cookieValue) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const bySlug = await getClientBySlug(slug);
  if (!bySlug || bySlug.id !== cookieValue) {
    return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
  }
  const client = await getClient(cookieValue);
  if (!client) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (!client.email) {
    return NextResponse.json({ error: "Este cliente no tiene email vinculado a un Unibox" }, { status: 400 });
  }

  const unibox = await findUniboxByClientEmail(client.email);
  if (!unibox) {
    return NextResponse.json({ error: "Aún no se ha creado un Unibox con tu email" }, { status: 404 });
  }

  const proto = req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "");
  const isHttps = proto === "https";
  const res = NextResponse.json({ ok: true, uniboxId: unibox.id, title: unibox.title });
  setSessionCookie(res, { uniboxId: unibox.id, clientEmail: unibox.client_email, iat: Date.now() }, isHttps);
  return res;
}
