import { NextRequest, NextResponse } from "next/server";
import { isOwner } from "@/lib/client-auth";
import { listClientAccounts, createClientAccount } from "@/lib/client-accounts";

export const runtime = "nodejs";

/** GET /api/client-accounts — lista de cuentas cliente (solo owner). */
export async function GET(req: NextRequest) {
  if (!isOwner(req)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const accounts = await listClientAccounts();
  return NextResponse.json({ accounts });
}

/** POST /api/client-accounts — crea cuenta cliente (solo owner). Body: { email, password, name? } */
export async function POST(req: NextRequest) {
  if (!isOwner(req)) return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { account, error } = await createClientAccount({
    email: String(body.email ?? ""),
    password: String(body.password ?? ""),
    name: body.name ? String(body.name) : undefined,
  });
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ ok: true, account });
}
