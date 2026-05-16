import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/debug
 * Devuelve la configuración exacta + el SCOPE que se está pidiendo,
 * para diagnosticar problemas de OAuth.
 */
export async function GET(req: Request) {
  const reqUrl = new URL(req.url);
  const detectedBase = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || `${reqUrl.protocol}//${reqUrl.host}`;
  const base = detectedBase.replace(/\/$/, "");
  const redirectUri = `${base}/api/drive/callback`;

  // Construir la URL completa de OAuth para que el usuario vea exactamente
  // qué se le envía a Google (incluido el scope).
  let authUrl = "";
  let scopeRequested = "";
  try {
    authUrl = getAuthUrl();
    const params = new URL(authUrl).searchParams;
    scopeRequested = params.get("scope") || "";
  } catch (e: any) {
    authUrl = `error: ${e.message}`;
  }

  return NextResponse.json({
    detected_base_url: base,
    redirect_uri_to_register_in_google_cloud: redirectUri,
    scope_being_requested: scopeRequested,
    scope_is_sensitive: /\/drive(\s|$)/.test(scopeRequested) || scopeRequested.includes("drive.metadata"),
    full_auth_url: authUrl,
    source: process.env.APP_BASE_URL
      ? "APP_BASE_URL"
      : process.env.NEXT_PUBLIC_APP_URL
      ? "NEXT_PUBLIC_APP_URL"
      : "auto-detected from request",
    request_host: reqUrl.host,
    request_protocol: reqUrl.protocol,
    has_client_id: !!(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID),
    has_client_secret: !!(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET),
    has_api_key: !!(process.env.GOOGLE_DRIVE_API_KEY || process.env.GOOGLE_API_KEY),
    client_id_length: (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").length,
    client_id_first_chars: (process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").slice(0, 12) + "...",
    code_version: "9b6228e+ (scope=drive.file)",
  });
}
