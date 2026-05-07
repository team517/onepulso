import { NextResponse } from "next/server";
import { authUrl } from "@/lib/linkedin";
import { randomUUID } from "crypto";

export const runtime = "nodejs";

export async function GET() {
  const state = randomUUID();
  const url = authUrl(state);
  // No persistimos state porque es single-user local; en multi-user habría que guardarlo
  return NextResponse.redirect(url);
}
