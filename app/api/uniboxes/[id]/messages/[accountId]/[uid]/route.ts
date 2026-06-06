import { NextRequest, NextResponse } from "next/server";
import { loadMessagesMap, saveMessagesMap, listAccounts } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";
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

  const map = await loadMessagesMap(id);
  const msgs = map[accountId] || [];
  const msg = msgs.find((m) => String(m.uid) === String(uid));
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

            // Guardar en cache para futuras lecturas
            const idx = msgs.findIndex((m) => String(m.uid) === String(uid));
            if (idx !== -1) {
              msgs[idx] = msg;
              map[accountId] = msgs;
              await saveMessagesMap(id, map);
            }
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

  const map = await loadMessagesMap(id);
  const msgs = map[accountId] || [];
  const before = msgs.length;
  map[accountId] = msgs.filter((m) => String(m.uid) !== String(uid));
  if (map[accountId].length === before) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  await saveMessagesMap(id, map);
  return NextResponse.json({ ok: true });
}
