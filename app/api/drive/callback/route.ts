import { NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const base = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || url.origin;

  if (error) {
    return NextResponse.redirect(`${base}/drive?error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return NextResponse.redirect(`${base}/drive?error=no_code`);
  }

  try {
    await exchangeCodeForTokens(code);
    return NextResponse.redirect(`${base}/drive?connected=1`);
  } catch (e: any) {
    return NextResponse.redirect(`${base}/drive?error=${encodeURIComponent(e.message || "unknown")}`);
  }
}
