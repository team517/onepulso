import { NextRequest, NextResponse } from "next/server";
import { listAccounts, addAccount } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

export async function GET() {
  const accounts = await listAccounts();
  return NextResponse.json({ accounts });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const api_key = String(body.api_key || "").trim();
  if (!title) return NextResponse.json({ error: "Falta título" }, { status: 400 });
  if (!api_key) return NextResponse.json({ error: "Falta API key" }, { status: 400 });

  const renews_at = typeof body.renews_at === "string" && body.renews_at.trim() ? body.renews_at : undefined;
  const plan_label = typeof body.plan_label === "string" && body.plan_label.trim() ? body.plan_label : undefined;

  const account = await addAccount({ title, api_key, renews_at, plan_label });
  return NextResponse.json({ account });
}
