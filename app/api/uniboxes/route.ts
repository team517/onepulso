import { NextRequest, NextResponse } from "next/server";
import { listUniboxes, createUnibox, findUniboxByClientEmail } from "@/lib/unibox-store";
import { requireAdmin } from "@/lib/unibox-auth";

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const all = await listUniboxes();
  // strip password hash
  const safe = all.map(({ client_password, client_password_salt, ...rest }) => rest);
  return NextResponse.json(safe);
}

export async function POST(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { title, client_email, client_password, warmup_filter, notes } = body;
  if (!title || !client_email || !client_password) {
    return NextResponse.json({ error: "Faltan: title, client_email, client_password" }, { status: 400 });
  }
  const exists = await findUniboxByClientEmail(client_email);
  if (exists) return NextResponse.json({ error: "Ya existe una unibox con ese email de cliente" }, { status: 400 });
  const u = await createUnibox({ title, client_email, client_password, warmup_filter, notes });
  const { client_password: _, client_password_salt: __, ...safe } = u;
  return NextResponse.json(safe);
}
