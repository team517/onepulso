import { NextRequest, NextResponse } from "next/server";
import { listAccounts, getUnibox } from "@/lib/unibox-store";
import { getMessageRow, setMessageBody, deleteMessageByUid } from "@/lib/unibox-messages-db";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";
import { isNonIberianMessage } from "@/lib/unibox-warmup";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; uid: string }> }
) {
  const { id, accountId, uid } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const msg = await getMessageRow(id, accountId, Number(uid));
  if (!msg) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  // ON-DEMAND BODY LOAD:
  // Si el mensaje no tiene cuerpo (sync fast mode), lo descargamos
  // desde IMAP ahora y lo cacheamos para futuras lecturas.
  if (!msg.text && !msg.html) {
    try {
      const accounts = await listAccounts(id);
      const account = accounts.find((a) => a.id === accountId);
      if (!account) return NextResponse.json(msg);

      const uidNum = Number(uid);
      // UID negativo = Sent folder. UID positivo = INBOX.
      const isSent = uidNum < 0;
      const realUid = isSent ? Math.abs(uidNum) : uidNum;

      const imapPort = account.imap_port || 993;
      const client = new ImapFlow({
        host: account.imap_host,
        port: imapPort,
        secure: imapPort === 993 || imapPort === 995,
        auth: { user: account.imap_user || account.email, pass: account.imap_pass },
        logger: false,
        tls: { rejectUnauthorized: false },
      });

      try {
        await client.connect();

        // Determinar el folder
        let folderPath = "INBOX";
        if (isSent) {
          const list = await client.list();
          const sentFolder = list.find((m: any) =>
            m.specialUse === "\\Sent" ||
            /\[Gmail\]\/Sent Mail/i.test(m.path) ||
            /\[Gmail\]\/Enviados/i.test(m.path) ||
            /^Sent$/i.test(m.path) ||
            /^Enviados$/i.test(m.path)
          );
          if (sentFolder) folderPath = sentFolder.path;
        }

        const lock = await client.getMailboxLock(folderPath);
        try {
          const fetched = await client.fetchOne(String(realUid), { source: true, envelope: true }, { uid: true });
          if (fetched && fetched.source) {
            const parsed = await simpleParser(fetched.source);
            msg.text = parsed.text || "";
            msg.html = (parsed.html as string) || "";
            msg.attachments = (parsed.attachments || []).map((a: any) => ({
              filename: a.filename || "",
              contentType: a.contentType || "",
              size: a.size || 0,
            }));
            const previewText = msg.text || (msg.html ? msg.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "");
            if (previewText) msg.preview = previewText.slice(0, 180);

            // RE-EVALUAR IDIOMA con el cuerpo completo: en uniboxes != tcx,
            // los mensajes RECIBIDOS que no son español/catalán pasan a warmup.
            // (Los enviados — is_sent / uid negativo — se respetan siempre.)
            if (!isSent && !msg.is_warmup) {
              try {
                const u = await getUnibox(id);
                const allowAll = (u?.title || "").toLowerCase().includes("tcx");
                if (!allowAll && isNonIberianMessage({ subject: msg.subject, text: msg.text, html: msg.html })) {
                  msg.is_warmup = true;
                }
              } catch {}
            }

            // Guardar el cuerpo en la fila del mensaje para futuras lecturas.
            await setMessageBody(id, accountId, Number(uid), {
              text: msg.text,
              html: msg.html,
              preview: msg.preview,
              attachments: msg.attachments,
              is_warmup: msg.is_warmup,
            });
          }
        } finally {
          lock.release();
        }
        await client.logout();
      } catch (e: any) {
        console.warn(`[messages] no se pudo cargar cuerpo del UID ${uid}: ${e?.message}`);
      }
    } catch (e: any) {
      console.warn(`[messages] error cargando cuerpo: ${e?.message}`);
    }
  }

  return NextResponse.json(msg);
}

/**
 * DELETE /api/uniboxes/[id]/messages/[accountId]/[uid]
 * Borra un único mensaje de la caché de la unibox (no toca el IMAP remoto).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; uid: string }> }
) {
  const { id, accountId, uid } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const ok = await deleteMessageByUid(id, accountId, Number(uid));
  if (!ok) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
