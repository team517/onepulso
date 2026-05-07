import { NextResponse } from "next/server";
import { getAuth, clearAuth } from "@/lib/linkedin";
import { startScheduler } from "@/lib/scheduler";

export const runtime = "nodejs";

// Arranca el scheduler la primera vez que el módulo carga
startScheduler();

export async function GET() {
  const auth = await getAuth();
  if (!auth) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    name: auth.name,
    email: auth.email,
    picture: auth.picture,
    user_urn: auth.user_urn,
    expires_at: auth.expires_at,
  });
}

export async function DELETE() {
  await clearAuth();
  return NextResponse.json({ ok: true });
}
