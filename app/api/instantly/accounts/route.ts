import { NextRequest, NextResponse } from "next/server";
import { listAccounts, addAccount, activateOwner } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

export async function GET() {
  const accounts = await listAccounts();
  return NextResponse.json({ accounts });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  // Acción especial: volver a la cuenta owner
  if (body.action === "activate_owner") {
    const ok = await activateOwner();
    if (!ok) return NextResponse.json({ error: "No hay cuenta marcada como propia" }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const title = String(body.title || "").trim();
  const api_key = String(body.api_key || "").trim();
  if (!title) return NextResponse.json({ error: "Falta título" }, { status: 400 });
  if (!api_key) return NextResponse.json({ error: "Falta API key" }, { status: 400 });

  const renews_at = typeof body.renews_at === "string" && body.renews_at.trim() ? body.renews_at : undefined;
  const plan_label = typeof body.plan_label === "string" && body.plan_label.trim() ? body.plan_label : undefined;
  const is_owner = body.is_owner === true;
  const client_company = typeof body.client_company === "string" ? body.client_company : undefined;
  const client_contact = typeof body.client_contact === "string" ? body.client_contact : undefined;

  const account = await addAccount({ title, api_key, renews_at, plan_label, is_owner, client_company, client_contact });
  return NextResponse.json({ account });
}
