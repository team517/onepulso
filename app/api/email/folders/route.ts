import type { NextRequest } from "next/server";
import { withRequestTenant } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { listFoldersDebug } from "@/lib/email-search";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withRequestTenant(req as any, async () => {
  const folders = await listFoldersDebug();
  return NextResponse.json({ folders });

  }) as any;
}
