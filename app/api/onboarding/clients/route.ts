import { NextRequest, NextResponse } from "next/server";
import { listClients, createClient } from "@/lib/onboarding";

export async function GET() {
  const clients = await listClients();
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name requerido" }, { status: 400 });
  }
  const client = await createClient({
    name: body.name,
    username: body.username,
    password: body.password,
    slug: body.slug,
    project_title: body.project_title,
    contact_name: body.contact_name,
    admin_notes: body.admin_notes,
  });
  return NextResponse.json({ client });
}
