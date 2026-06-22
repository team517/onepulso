import { NextRequest } from "next/server";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { getUnibox, listAccounts, saveAccounts } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Verificación: solo conectar IMAP + SMTP, login, logout. SIN descargar
// mensajes. Súper rápido — 1-3s por cuenta. Concurrencia alta.
const CONCURRENCY = 30;
const PER_ACCOUNT_TIMEOUT_MS = 15_000; // 15s es suficiente para connect+auth

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return new Response("Unauthorized", { status: 401 });

  const u = await getUnibox(id);
  if (!u) return new Response("Not found", { status: 404 });

  const accs = await listAccounts(id);

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
      // Latido: evita que un proxy corte la conexión mientras verifica cuentas
      // lentas (mismo patrón anti-corte que la verificación de emails).
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { closed = true; }
      }, 10_000);
      send("start", { total: accs.length });

      const finalStatus = new Map<string, "ok" | "fail">();
      const startTs = Date.now();

      async function verifyOne(a: any): Promise<boolean> {
        const start = Date.now();
        const ok = () => Array.from(finalStatus.values()).filter(s => s === "ok").length;
        const fail = () => Array.from(finalStatus.values()).filter(s => s === "fail").length;
        send("progress", {
          index: ok() + fail() + 1, total: accs.length, email: a.email, phase: "connecting",
          message: `Verificando IMAP+SMTP de ${a.imap_host}...`,
        });

        try {
          const imapPort = a.imap_port || 993;
          const imap = new ImapFlow({
            host: a.imap_host,
            port: imapPort,
            secure: imapPort === 993 || imapPort === 995,
            auth: { user: a.imap_user || a.email, pass: a.imap_pass },
            logger: false,
            tls: { rejectUnauthorized: false },
            socketTimeout: PER_ACCOUNT_TIMEOUT_MS,
          });

          await Promise.race([
            (async () => {
              // 1) IMAP connect + auth
              await imap.connect();
              // 2) SMTP verify (en paralelo con cerrar IMAP)
              const smtpPort = a.smtp_port || 587;
              const secure = smtpPort === 465;
              const transporter = nodemailer.createTransport({
                host: a.smtp_host,
                port: smtpPort,
                secure,
                auth: { user: a.smtp_user || a.email, pass: a.smtp_pass },
                tls: { rejectUnauthorized: false },
                requireTLS: !secure && smtpPort === 587,
                connectionTimeout: PER_ACCOUNT_TIMEOUT_MS,
                greetingTimeout: PER_ACCOUNT_TIMEOUT_MS,
                socketTimeout: PER_ACCOUNT_TIMEOUT_MS,
              } as any);
              await transporter.verify();
              try { transporter.close?.(); } catch {}
              try { await imap.logout(); } catch {}
            })(),
            new Promise<void>((_, rej) =>
              setTimeout(() => rej(new Error(`Timeout ${PER_ACCOUNT_TIMEOUT_MS / 1000}s`)), PER_ACCOUNT_TIMEOUT_MS),
            ),
          ]);

          // OK — actualizar last_sync (lo usamos como "verificado")
          finalStatus.set(a.id, "ok");
          send("progress", {
            index: ok() + fail(), total: accs.length, email: a.email, phase: "ok",
            message: `✓ IMAP+SMTP OK · ${Date.now() - start}ms`,
          });
          return true;
        } catch (e: any) {
          finalStatus.set(a.id, "fail");
          send("progress", {
            index: ok() + fail(), total: accs.length, email: a.email, phase: "error",
            message: `✗ ${(e.message || String(e)).slice(0, 200)}`,
          });
          return false;
        }
      }

      // Procesar TODAS las cuentas en paralelo de a CONCURRENCY
      for (let i = 0; i < accs.length; i += CONCURRENCY) {
        const batch = accs.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map((a) => verifyOne(a)));
      }

      // Actualizar last_sync/last_error en bulk
      try {
        const freshAccs = await listAccounts(id);
        const now = new Date().toISOString();
        for (const acc of freshAccs) {
          const status = finalStatus.get(acc.id);
          if (status === "ok") {
            acc.last_sync = now;
            acc.last_error = null;
          } else if (status === "fail") {
            acc.last_error = "Verificación falló";
          }
        }
        await saveAccounts(id, freshAccs);
      } catch (e: any) {
        console.warn("[verify-all] no se pudieron actualizar las cuentas:", e?.message);
      }

      const finalOk = Array.from(finalStatus.values()).filter(s => s === "ok").length;
      const finalFail = Array.from(finalStatus.values()).filter(s => s === "fail").length;
      send("done", { ok: finalOk, fail: finalFail, total: accs.length, elapsed_ms: Date.now() - startTs });
      clearInterval(heartbeat);
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
