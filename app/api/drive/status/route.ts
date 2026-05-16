import { NextResponse } from "next/server";
import { getTokens, getConfig, isDriveConfigured, clearTokens } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isDriveConfigured();

  // Detalle de qué vars existen (sin revelar los valores) — útil para debug
  const detected = {
    GOOGLE_DRIVE_CLIENT_ID: !!process.env.GOOGLE_DRIVE_CLIENT_ID,
    GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
    GOOGLE_DRIVE_CLIENT_SECRET: !!process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
    APP_BASE_URL: !!process.env.APP_BASE_URL,
    NEXT_PUBLIC_APP_URL: !!process.env.NEXT_PUBLIC_APP_URL,
  };

  if (!configured) {
    const missing: string[] = [];
    if (!detected.GOOGLE_DRIVE_CLIENT_ID && !detected.GOOGLE_CLIENT_ID) missing.push("GOOGLE_DRIVE_CLIENT_ID");
    if (!detected.GOOGLE_DRIVE_CLIENT_SECRET && !detected.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_DRIVE_CLIENT_SECRET");
    return NextResponse.json({
      connected: false,
      configured: false,
      detected,
      missing,
      message:
        missing.length > 0
          ? `Faltan: ${missing.join(", ")}`
          : "Variables detectadas pero vacías. Revisa los valores.",
    });
  }
  const tokens = await getTokens();
  const cfg = await getConfig();
  return NextResponse.json({
    configured: true,
    connected: !!tokens,
    user_email: tokens?.user_email,
    watched_folders: cfg.watched_folders,
    detected,
  });
}

export async function DELETE() {
  await clearTokens();
  return NextResponse.json({ ok: true });
}
