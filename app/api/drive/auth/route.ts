import { NextResponse } from "next/server";
import { getAuthUrl, isDriveConfigured } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET() {
  if (!isDriveConfigured()) {
    return NextResponse.json(
      {
        error:
          "Faltan GOOGLE_DRIVE_CLIENT_ID y GOOGLE_DRIVE_CLIENT_SECRET en las variables de entorno de Railway.",
      },
      { status: 500 }
    );
  }
  return NextResponse.redirect(getAuthUrl());
}
