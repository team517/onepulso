import { NextResponse } from "next/server";
import { getTokens } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/drive/picker-config
 * Devuelve la config necesaria para abrir Google Drive Picker en el cliente:
 *  - access_token: para autorizar al Picker
 *  - api_key: para que el SDK del Picker llame a Google
 *  - app_id (project number): si está configurado
 */
export async function GET() {
  const tokens = await getTokens();
  if (!tokens) {
    return NextResponse.json({ error: "No conectado a Drive" }, { status: 401 });
  }
  // Refrescar token si caducó
  const validToken = await getValidToken();
  if (!validToken) {
    return NextResponse.json({ error: "Token expirado y no se pudo refrescar" }, { status: 401 });
  }

  const apiKey =
    process.env.GOOGLE_DRIVE_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    "";

  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta GOOGLE_DRIVE_API_KEY en Railway. Crea una API Key en Google Cloud Console → Credenciales → + Crear credenciales → Clave de API.",
        access_token: validToken,
      },
      { status: 500 }
    );
  }

  // app_id (project number, no project id) — opcional pero recomendado
  const appId = process.env.GOOGLE_DRIVE_APP_ID || "";

  return NextResponse.json({
    access_token: validToken,
    api_key: apiKey,
    app_id: appId || undefined,
    user_email: tokens.user_email,
  });
}

async function getValidToken(): Promise<string | null> {
  const tokens = await getTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expires_at) return tokens.access_token;
  // Refrescar
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "",
        refresh_token: tokens.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    // Guardar el nuevo (no usar writeJson aquí para evitar import circular)
    const { writeJson } = await import("@/lib/storage");
    const updated = { ...tokens, access_token: data.access_token, expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000 };
    await writeJson("google-drive-tokens", updated);
    return updated.access_token;
  } catch {
    return null;
  }
}
