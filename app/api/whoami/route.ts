import { NextRequest, NextResponse } from "next/server";
import { getClientSession, isOwner } from "@/lib/client-auth";

export const runtime = "nodejs";

/**
 * GET /api/whoami
 * Rol de quien mira la app: owner (dueño), client (cliente multi-tenant) o anon.
 * Lo usa DashboardNav para filtrar las secciones visibles y el botón de salir.
 */
export async function GET(req: NextRequest) {
  if (isOwner(req)) {
    return NextResponse.json({ role: "owner", email: process.env.AUTH_EMAIL || "team@onepulso.online" });
  }
  const s = getClientSession(req);
  if (s) {
    return NextResponse.json({ role: "client", email: s.email, clientId: s.clientId });
  }
  return NextResponse.json({ role: "anon" });
}
