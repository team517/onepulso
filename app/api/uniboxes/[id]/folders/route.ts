import { NextRequest, NextResponse } from "next/server";
import { listFolders, createFolder } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

/** GET /api/uniboxes/[id]/folders → lista de carpetas */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const folders = await listFolders(id);
  return NextResponse.json(folders);
}

/** POST /api/uniboxes/[id]/folders body: { name, color? } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "Falta nombre" }, { status: 400 });
  const color = body?.color ? String(body.color) : undefined;
  const f = await createFolder(id, name, color);
  return NextResponse.json(f);
}
