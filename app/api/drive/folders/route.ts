import { NextResponse } from "next/server";
import { listFolders } from "@/lib/google-drive";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || undefined;
  const parentId = url.searchParams.get("parentId") || undefined;
  try {
    const folders = await listFolders({ q, parentId, pageSize: 100 });
    return NextResponse.json({ folders });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
