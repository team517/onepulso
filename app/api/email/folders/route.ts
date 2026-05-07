import { NextResponse } from "next/server";
import { listFoldersDebug } from "@/lib/email-search";

export const runtime = "nodejs";

export async function GET() {
  const folders = await listFoldersDebug();
  return NextResponse.json({ folders });
}
