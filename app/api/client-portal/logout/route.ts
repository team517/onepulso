import { NextResponse } from "next/server";
import { clearClientCookie } from "@/lib/client-auth";

export const runtime = "nodejs";

/** POST /api/client-portal/logout */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  clearClientCookie(res);
  return res;
}
