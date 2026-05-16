import { NextResponse } from "next/server";
import { listFolders, createFolder, renameFolder, deleteFolder } from "@/lib/documents";

export const runtime = "nodejs";

export async function GET() {
  const folders = await listFolders();
  return NextResponse.json({ folders });
}

/** POST { name } — crea carpeta */
export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name requerido" }, { status: 400 });
  try {
    const folders = await createFolder(body.name);
    return NextResponse.json({ folders });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/** PATCH { old, new } — renombra carpeta */
export async function PATCH(req: Request) {
  const body = await req.json();
  if (!body.old || !body.new) {
    return NextResponse.json({ error: "old y new requeridos" }, { status: 400 });
  }
  try {
    const r = await renameFolder(body.old, body.new);
    const folders = await listFolders();
    return NextResponse.json({ ...r, folders });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

/** DELETE ?name=X[&force=1][&deleteDocs=1] — elimina carpeta */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const name = url.searchParams.get("name");
  if (!name) return NextResponse.json({ error: "Falta name" }, { status: 400 });
  const force = url.searchParams.get("force") === "1";
  const deleteDocs = url.searchParams.get("deleteDocs") === "1";
  try {
    const r = await deleteFolder(name, { force, deleteDocs });
    const folders = await listFolders();
    return NextResponse.json({ ...r, folders });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
