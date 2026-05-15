import { NextRequest, NextResponse } from "next/server";
import { getUnibox, loadMessagesMap } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const u = await getUnibox(id);
  if (!u) return NextResponse.json({ error: "No encontrada" }, { status: 404 });

  const url = new URL(req.url);
  const accountFilter = url.searchParams.get("account");
  const showWarmup = url.searchParams.get("show_warmup") === "1";

  const map = await loadMessagesMap(id);
  const out: any[] = [];
  let warmupCount = 0;
  for (const accId of Object.keys(map)) {
    if (accountFilter && accountFilter !== accId) continue;
    for (const m of map[accId]) {
      if (m.is_warmup) {
        warmupCount++;
        if (!showWarmup) continue;
      }
      // Strip heavy fields from list response — keep preview + meta
      const { text, html, ...rest } = m;
      out.push({ ...rest, accountId: accId });
    }
  }
  out.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return NextResponse.json({ messages: out.slice(0, 500), warmupCount });
}
