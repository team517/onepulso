import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const slug = String(body.slug || "").toLowerCase().trim();
  const res = NextResponse.json({ ok: true });
  if (slug) {
    res.cookies.set({
      name: `onboarding_client_${slug}`,
      value: "",
      maxAge: 0,
      path: "/",
    });
  }
  return res;
}
