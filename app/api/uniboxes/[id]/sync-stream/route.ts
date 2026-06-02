import { NextRequest } from "next/server";
import { getUnibox, listAccounts } from "@/lib/unibox-store";
import { syncAccount, syncAccountSent } from "@/lib/unibox-sync";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONCURRENCY = 10;
const PER_ACCOUNT_TIMEOUT_MS = 15_000;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return new Response("Unauthorized", { status: 401 });

  const u = await getUnibox(id);
  if (!u) return new Response("Not found", { status: 404 });

  const url = new URL(req.url);
  const idsParam = url.searchParams.get("ids") || "";
  const idsFilter = idsParam.split(",").filter(Boolean);
  const accs = await listAccounts(id);
  const targets = idsFilter.length ? accs.filter((a) => idsFilter.includes(a.id)) : accs;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      send("start", { total: targets.length });

      let ok = 0, fail = 0, completedIdx = 0;
      const startTs = Date.now();

      // Procesa una cuenta concreta — INBOX + Sent en PARALELO + timeout 15s.
      async function processOne(a: any, index: number) {
        const accountStart = Date.now();
        send("progress", {
          index, total: targets.length, email: a.email, phase: "connecting",
          message: `Conectando a ${a.imap_host}...`,
        });
        try {
          const inboxP = syncAccount(id, a.id);
          const sentP = syncAccountSent(id, a.id).catch(() => 0);
          const [inboxNew, sentNew] = await Promise.race([
            Promise.all([inboxP, sentP]),
            new Promise<[number, number]>((_, rej) =>
              setTimeout(() => rej(new Error(`Timeout ${PER_ACCOUNT_TIMEOUT_MS / 1000}s`)), PER_ACCOUNT_TIMEOUT_MS),
            ),
          ]) as [number, number];
          ok++;
          completedIdx++;
          send("progress", {
            index: completedIdx, total: targets.length, email: a.email, phase: "ok",
            message: `✓ ${inboxNew + sentNew} mensaje(s) nuevo(s) · ${Date.now() - accountStart}ms`,
          });
        } catch (e: any) {
          fail++;
          completedIdx++;
          send("progress", {
            index: completedIdx, total: targets.length, email: a.email, phase: "error",
            message: `✗ ${(e.message || String(e)).slice(0, 200)}`,
          });
        }
      }

      // PARALELO con concurrencia limitada (10 a la vez en vez de 1 secuencial).
      // Para 25 cuentas: pasa de ~75s (3s × 25 serial) a ~10s (3 lotes de 10).
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        await Promise.allSettled(
          batch.map((a, j) => processOne(a, i + j + 1))
        );
      }

      send("done", { ok, fail, total: targets.length, elapsed_ms: Date.now() - startTs });
      try { controller.close(); } catch {}
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
