import { NextRequest, NextResponse } from "next/server";
import { deleteAccount } from "@/lib/unibox-store";
import { requireAdmin } from "@/lib/unibox-auth";

export const runtime = "nodejs";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const { id, accountId } = await params;
  await deleteAccount(id, accountId);
  return NextResponse.json({ ok: true });
}
