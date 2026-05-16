import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/debug
 * Devuelve la configuración exacta que se usa para construir las URLs OAuth.
 * Útil para diagnosticar mismatches del redirect_uri.
 */
export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const detectedBase = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || `${reqUrl.protocol}//${reqUrl.host}`;
  const base = detectedBase.replace(/\/$/, "");
  const redirectUri = `${base}/api/drive/callback`;

  return NextResponse.json({
    detected_base_url: base,
    redirect_uri_to_register_in_google_cloud: redirectUri,
    source: process.env.APP_BASE_URL
      ? "APP_BASE_URL"
      : process.env.NEXT_PUBLIC_APP_URL
      ? "NEXT_PUBLIC_APP_URL"
      : "auto-detected from request",
    request_host: reqUrl.host,
    request_protocol: reqUrl.protocol,
    has_client_id: !!(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
    has_client_secret: !!(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET),
    client_id_length: (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").length,
    client_id_first_chars: (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").slice(0, 12) + "...",
  });
}
