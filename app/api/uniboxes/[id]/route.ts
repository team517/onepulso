import { NextRequest, NextResponse } from "next/server";
import { getUnibox, deleteUnibox, updateUnibox, setUniboxPassword, listAccounts } from "@/lib/unibox-store";
import { requireAdmin } from "@/lib/unibox-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const u = await getUnibox(id);
  if (!u) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const accs = await listAccounts(id);
  const { client_password, client_password_salt, ...safe } = u;
  return NextResponse.json({ ...safe, account_count: accs.length });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body.client_password) {
    await setUniboxPassword(id, body.client_password);
    delete body.client_password;
  }
  const updated = await updateUnibox(id, body);
  if (!updated) return NextResponse.json({ error: "No encontrada" }, { status: 404 });
  const { client_password, client_password_salt, ...safe } = updated;
  return NextResponse.json(safe);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { id } = await params;
  await deleteUnibox(id);
  return NextResponse.json({ ok: true });
}
