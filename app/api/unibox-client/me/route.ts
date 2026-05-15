import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/unibox-auth";
import { getUnibox } from "@/lib/unibox-store";

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ authenticated: false });
  const u = await getUnibox(session.uniboxId);
  if (!u) return NextResponse.json({ authenticated: false });
  return NextResponse.json({
    authenticated: true,
    uniboxId: u.id,
    title: u.title,
    clientEmail: u.client_email,
  });
}
