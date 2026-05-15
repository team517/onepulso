import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Allow either admin OR the client of this unibox
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const accs = await listAccounts(id);
  // Hide passwords from response
  const safe = accs.map(({ imap_pass, smtp_pass, ...rest }) => rest);
  return NextResponse.json(safe);
}
