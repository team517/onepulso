import { NextResponse } from "next/server";
import { addWatchedFolder, removeWatchedFolder, getConfig, getFolderPath } from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const cfg = await getConfig();
  return NextResponse.json({ watched_folders: cfg.watched_folders });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.id || !body.name) {
    return NextResponse.json({ error: "Faltan id y name" }, { status: 400 });
  }
  // Construir path completo (Mi unidad / X / Y)
  let path = body.path;
  if (!path) {
    try {
      path = await getFolderPath(body.id);
    } catch {
      path = body.name;
    }
  }
  const cfg = await addWatchedFolder({ id: body.id, name: body.name, path });
  return NextResponse.json({ watched_folders: cfg.watched_folders });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Falta id" }, { status: 400 });
  const cfg = await removeWatchedFolder(id);
  return NextResponse.json({ watched_folders: cfg.watched_folders });
}
