import { NextResponse } from "next/server";
import { listFiles, getConfig, isFolderWatched } from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 30;

/** GET /api/drive/files?folder_id=X — lista archivos de una carpeta watched */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const folderId = url.searchParams.get("folder_id");
  if (!folderId) return NextResponse.json({ error: "Falta folder_id" }, { status: 400 });
  // Seguridad: solo permitir listar archivos de carpetas watched
  const cfg = await getConfig();
  if (!isFolderWatched(cfg, folderId)) {
    return NextResponse.json({ error: "Carpeta no está en la lista de seleccionadas" }, { status: 403 });
  }
  try {
    const files = await listFiles(folderId);
    return NextResponse.json({ files });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
