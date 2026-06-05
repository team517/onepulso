import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/unibox-store";
import { forceFullResync } from "@/lib/unibox-sync";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/uniboxes/[id]/force-resync
 * Resetea last_uid_inbox/last_uid_sent para TODAS las cuentas y dispara
 * sync completo (últimos 1500 mensajes por carpeta). Usar cuando el
 * usuario sospecha que faltan mensajes que sí están en el servidor IMAP.
 *
 * Body opcional: { accountId: "..." } para resync de UNA sola cuenta.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const session = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !session) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const targetAccountId = body?.accountId as string | undefined;

  const accs = await listAccounts(id);
  const targets = targetAccountId ? accs.filter((a) => a.id === targetAccountId) : accs;

  console.log(`[force-resync] unibox=${id} accounts=${targets.length}`);

  // Concurrencia 5 — más conservador que el sync normal porque trae 1500 msgs.
  const results: Array<{ email: string; inbox: number; sent: number; error?: string }> = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const batch = targets.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (acc) => {
        try {
          const r = await forceFullResync(id, acc.id);
          return { email: acc.email, inbox: r.inbox, sent: r.sent };
        } catch (e: any) {
          return { email: acc.email, inbox: 0, sent: 0, error: e?.message || String(e) };
        }
      })
    );
    results.push(...batchResults);
  }

  const totalInbox = results.reduce((s, r) => s + r.inbox, 0);
  const totalSent = results.reduce((s, r) => s + r.sent, 0);
  const errors = results.filter((r) => r.error).length;

  return NextResponse.json({
    ok: true,
    accounts: results.length,
    totalInbox,
    totalSent,
    errors,
    results,
  });
}
