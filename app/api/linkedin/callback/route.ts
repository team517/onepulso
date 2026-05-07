import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForToken } from "@/lib/linkedin";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  if (error) {
    return NextResponse.redirect(`${url.origin}/linkedin?error=${encodeURIComponent(errorDesc ?? error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${url.origin}/linkedin?error=missing_code`);
  }
  try {
    await exchangeCodeForToken(code);
    return NextResponse.redirect(`${url.origin}/linkedin?connected=1`);
  } catch (e: any) {
    return NextResponse.redirect(`${url.origin}/linkedin?error=${encodeURIComponent(e.message)}`);
  }
}
