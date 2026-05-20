import { NextRequest, NextResponse } from "next/server";
import { listClients, updateClient } from "@/lib/onboarding";

/**
 * GET /api/onboarding/clients/by-email?email=foo@bar.com
 * Busca el cliente de onboarding cuyo email coincida.
 */
export async function GET(req: NextRequest) {
  const email = (req.nextUrl.searchParams.get("email") || "").toLowerCase().trim();
  if (!email) return NextResponse.json({ error: "email requerido" }, { status: 400 });
  const all = await listClients();
  const client = all.find((c) => (c.email || "").toLowerCase() === email) ?? null;
  return NextResponse.json({ client });
}

/**
 * PATCH /api/onboarding/clients/by-email   body: { email, unibox_password }
 * Guarda el password del Unibox en el cliente onboarding que tenga ese email.
 * Lo llama el flujo de creación de Unibox para que el portal del cliente pueda
 * mostrar sus credenciales.
 */
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").toLowerCase().trim();
  const unibox_password = String(body.unibox_password || "").trim();
  if (!email || !unibox_password) {
    return NextResponse.json({ error: "email y unibox_password requeridos" }, { status: 400 });
  }
  const all = await listClients();
  const target = all.find((c) => (c.email || "").toLowerCase() === email);
  if (!target) return NextResponse.json({ client: null, matched: false });
  const updated = await updateClient(target.id, { unibox_password });
  return NextResponse.json({ client: updated, matched: true });
}
