import { NextResponse } from "next/server";
import { getTokens, getConfig, isDriveConfigured, clearTokens } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET() {
  const configured = isDriveConfigured();
  if (!configured) {
    return NextResponse.json({
      connected: false,
      configured: false,
      message: "Faltan GOOGLE_DRIVE_CLIENT_ID y GOOGLE_DRIVE_CLIENT_SECRET en Railway.",
    });
  }
  const tokens = await getTokens();
  const cfg = await getConfig();
  return NextResponse.json({
    configured: true,
    connected: !!tokens,
    user_email: tokens?.user_email,
    watched_folders: cfg.watched_folders,
  });
}

export async function DELETE() {
  await clearTokens();
  return NextResponse.json({ ok: true });
}
