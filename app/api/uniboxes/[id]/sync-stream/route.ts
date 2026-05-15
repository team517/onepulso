import { NextRequest } from "next/server";
import { getUnibox, listAccounts } from "@/lib/unibox-store";
import { syncAccount } from "@/lib/unibox-sync";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) {
    return new Response("Unauthorized", { status: 401 });
  }
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
      const send = (event: string, data: any) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      send("start", { total: targets.length });
      let ok = 0, fail = 0;
      for (let i = 0; i < targets.length; i++) {
        const a = targets[i];
        send("progress", {
          index: i + 1, total: targets.length, email: a.email, phase: "connecting",
          message: `Conectando a ${a.imap_host}:${a.imap_port}...`,
        });
        try {
          const t0 = Date.now();
          const newMsgs = await Promise.race([
            syncAccount(id, a.id),
            new Promise<number>((_, rej) => setTimeout(() => rej(new Error("Timeout (20s)")), 20000)),
          ]);
          ok++;
          send("progress", {
            index: i + 1, total: targets.length, email: a.email, phase: "ok",
            message: `✓ Conectada · ${newMsgs} mensaje(s) nuevo(s) · ${Date.now() - t0}ms`,
          });
        } catch (e: any) {
          fail++;
          send("progress", {
            index: i + 1, total: targets.length, email: a.email, phase: "error",
            message: `✗ ${(e.message || String(e)).slice(0, 200)}`,
          });
        }
      }
      send("done", { ok, fail, total: targets.length });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
