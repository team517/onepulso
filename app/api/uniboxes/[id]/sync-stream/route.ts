import { NextRequest } from "next/server";
import { getUnibox, listAccounts } from "@/lib/unibox-store";
import { syncAccount, syncAccountSent } from "@/lib/unibox-sync";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600; // 10 min — para descargar todo el histórico de 50+ cuentas

// 15 cuentas en paralelo — más conservador que 30 para evitar que IONOS
// rate-limite o rechace conexiones por exceso simultáneo. Más fiable.
const CONCURRENCY = 15;
// Timeout 8 min por cuenta — para descargas completas de histórico
// con cuentas que pueden tener miles de mensajes.
const PER_ACCOUNT_TIMEOUT_MS = 8 * 60_000;
// Reintentos automáticos para cuentas fallidas: 2 reintentos con backoff.
const RETRY_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 3_000;

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

      // accountId → "ok" | "fail" — estado final por cuenta
      const finalStatus = new Map<string, "ok" | "fail">();
      const startTs = Date.now();

      // Procesa una cuenta. Devuelve true si OK, false si falló.
      async function processOne(a: any, attempt: number = 1): Promise<boolean> {
        const accountStart = Date.now();
        const attemptLabel = attempt > 1 ? ` (reintento ${attempt - 1})` : "";
        const ok = () => Array.from(finalStatus.values()).filter(s => s === "ok").length;
        const fail = () => Array.from(finalStatus.values()).filter(s => s === "fail").length;
        send("progress", {
          index: ok() + fail() + 1, total: targets.length, email: a.email, phase: "connecting",
          message: `Conectando a ${a.imap_host}${attemptLabel}...`,
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
          finalStatus.set(a.id, "ok");
          send("progress", {
            index: ok() + fail(), total: targets.length, email: a.email, phase: "ok",
            message: `✓ ${inboxNew + sentNew} mensaje(s) nuevo(s) · ${Date.now() - accountStart}ms${attemptLabel}`,
          });
          return true;
        } catch (e: any) {
          finalStatus.set(a.id, "fail");
          send("progress", {
            index: ok() + fail(), total: targets.length, email: a.email, phase: "error",
            message: `✗ ${(e.message || String(e)).slice(0, 200)}${attemptLabel}`,
          });
          return false;
        }
      }

      // Primer pase: TODAS las cuentas en paralelo de a CONCURRENCY.
      const failedAccounts: any[] = [];
      for (let i = 0; i < targets.length; i += CONCURRENCY) {
        const batch = targets.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          batch.map((a) => processOne(a, 1).then((success) => ({ a, success })))
        );
        for (const { a, success } of results) {
          if (!success) failedAccounts.push(a);
        }
      }

      // REINTENTOS: las que fallaron se vuelven a intentar con menor
      // concurrencia (5) y backoff. Cubre fallos transitorios (timeout,
      // connection refused por rate-limit, SSL handshake, etc).
      for (let attempt = 2; attempt <= RETRY_ATTEMPTS + 1 && failedAccounts.length > 0; attempt++) {
        const toRetry = [...failedAccounts];
        failedAccounts.length = 0;
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        const RETRY_CONCURRENCY = 5; // muy conservador en reintentos
        for (let i = 0; i < toRetry.length; i += RETRY_CONCURRENCY) {
          const batch = toRetry.slice(i, i + RETRY_CONCURRENCY);
          const results = await Promise.all(
            batch.map((a) => processOne(a, attempt).then((success) => ({ a, success })))
          );
          for (const { a, success } of results) {
            if (!success) failedAccounts.push(a);
          }
        }
      }

      const finalOk = Array.from(finalStatus.values()).filter(s => s === "ok").length;
      const finalFail = Array.from(finalStatus.values()).filter(s => s === "fail").length;
      send("done", { ok: finalOk, fail: finalFail, total: targets.length, elapsed_ms: Date.now() - startTs });
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
