import { NextRequest, NextResponse } from "next/server";
import { listAccounts, addAccount } from "@/lib/instantly-accounts";

export const runtime = "nodejs";

/** GET — lista cuentas (sin exponer la api_key completa) */
export async function GET() {
  const accounts = await listAccounts();
  return NextResponse.json({ accounts });
}

/** POST — añade una nueva cuenta */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  const api_key = String(body.api_key || "").trim();
  if (!title) return NextResponse.json({ error: "Falta título" }, { status: 400 });
  if (!api_key) return NextResponse.json({ error: "Falta API key" }, { status: 400 });
  const account = await addAccount({ title, api_key });
  return NextResponse.json({ account });
}
