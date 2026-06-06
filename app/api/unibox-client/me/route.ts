import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/unibox-auth";
import { getUnibox } from "@/lib/unibox-store";

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ authenticated: false });

  let u: Awaited<ReturnType<typeof getUnibox>>;
  try {
    u = await getUnibox(session.uniboxId);
  } catch (err: any) {
    // La base de datos no está disponible (timeout, pool corrupto, etc.).
    // Devolvemos 503 para que el cliente pueda mostrar un mensaje amigable
    // en lugar de redirigir al login o quedarse colgado.
    console.error("[unibox-client/me] DB unavailable:", err?.message ?? err);
    return NextResponse.json(
      { error: "database_unavailable", message: "Database is recovering, please try again in a moment" },
      { status: 503 }
    );
  }

  if (!u) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    uniboxId: u.id,
    title: u.title,
    clientEmail: u.client_email,
  });
}

