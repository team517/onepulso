import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { listAccounts } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = requireAdmin(req);
  const clientSession = isAdmin ? null : await requireClientForUnibox(req, id);
  if (!isAdmin && !clientSession) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const form = await req.formData();
  const accountId = String(form.get("accountId") || "");
  const to = String(form.get("to") || "");
  const cc = String(form.get("cc") || "");
  const bcc = String(form.get("bcc") || "");
  const subject = String(form.get("subject") || "");
  const body = String(form.get("body") || "");
  const inReplyTo = String(form.get("inReplyTo") || "");
  const references = String(form.get("references") || "");

  const accs = await listAccounts(id);
  const acc = accs.find((a) => a.id === accountId);
  if (!acc) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 400 });
  if (!to) return NextResponse.json({ error: "Falta destinatario" }, { status: 400 });

  const port = acc.smtp_port || 587;
  const secure = port === 465;
  const transporter = nodemailer.createTransport({
    host: acc.smtp_host,
    port,
    secure,
    auth: { user: acc.smtp_user || acc.email, pass: acc.smtp_pass },
    tls: { rejectUnauthorized: false },
    requireTLS: !secure && port === 587,
  });

  const files = form.getAll("attachments") as File[];
  const attachments = await Promise.all(
    files.map(async (f) => ({
      filename: f.name,
      content: Buffer.from(await f.arrayBuffer()),
    }))
  );

  const hasHtml = /<[a-z][\s\S]*>/i.test(body);
  let html = hasHtml ? body : body.replace(/\n/g, "<br>");

  // Detectar si el body ya trae la firma (con los markers que pone el cliente).
  const SIG_MARKER_START = '<!-- onepulso-sig-start -->';
  const SIG_MARKER_END = '<!-- onepulso-sig-end -->';
  const hasMarkerSig = html.includes(SIG_MARKER_START);

  // AUTO-FIRMA: si la cuenta tiene signature configurada Y el body NO la trae ya
  if (acc.signature_html && acc.signature_html.trim().length > 0 && !hasMarkerSig) {
    // Fallback: huella por texto plano por si vino sin markers (compose viejo, plain text, etc.)
    const sigPlain = acc.signature_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const sigSample = sigPlain.slice(0, 40);
    const bodyPlain = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const alreadyHasSig = sigSample && bodyPlain.includes(sigSample);
    if (!alreadyHasSig) {
      html = html + `\n<br><br>\n${acc.signature_html}`;
    }
  }

  // QUITAR markers HTML antes de enviar (el destinatario no debe verlos).
  html = html.replaceAll(SIG_MARKER_START, "").replaceAll(SIG_MARKER_END, "");

  const displayName = [acc.first_name, acc.last_name].filter(Boolean).join(" ") || acc.email;

  /** Normaliza un message-id para que SIEMPRE tenga <...>.
   *  mailparser a veces devuelve "abc@xyz.com" sin corchetes; sin ellos
   *  el servidor SMTP receptor no agrupa el mensaje en el hilo correcto. */
  const wrapMsgId = (id: string): string => {
    const s = id.trim();
    if (!s) return "";
    if (s.startsWith("<") && s.endsWith(">")) return s;
    return `<${s.replace(/^<+|>+$/g, "")}>`;
  };

  const normalizedInReplyTo = inReplyTo ? wrapMsgId(inReplyTo) : "";

  // Asegurar prefijo "Re: " sin duplicarlo (si el usuario lo quitó por error)
  let finalSubject = subject || "(sin asunto)";
  if (normalizedInReplyTo && !/^re:\s*/i.test(finalSubject)) {
    finalSubject = `Re: ${finalSubject}`;
  }

  const mail: any = {
    from: `"${displayName}" <${acc.email}>`,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject: finalSubject,
    text: html.replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").trim(),
    html,
    attachments,
  };
  if (normalizedInReplyTo) {
    mail.inReplyTo = normalizedInReplyTo;
    // Construir cadena de References completa, todas con <>:
    const refList = (references ? references.split(/\s+/).filter(Boolean).map(wrapMsgId) : []);
    if (!refList.includes(normalizedInReplyTo)) refList.push(normalizedInReplyTo);
    mail.references = refList;
    // Cabeceras explícitas como respaldo por si nodemailer no las pone bien
    mail.headers = {
      "In-Reply-To": normalizedInReplyTo,
      "References": refList.join(" "),
    };
  }

  let info: any;
  try {
    info = await transporter.sendMail(mail);
  } catch (e: any) {
    console.error(`[unibox-send] SMTP error ${acc.email}: ${e?.message || e}`);
    return NextResponse.json({
      error: `Error enviando: ${e?.message || String(e)}`,
      smtp_host: acc.smtp_host,
      smtp_port: port,
    }, { status: 500 });
  }

  console.log(`[unibox-send] ✓ ${acc.email} → ${to} (${info?.messageId})`);

  // CRÍTICO: NO bloquear la respuesta esperando al sync de Sent. El SMTP
  // ya tuvo éxito, el mensaje SE ENVIÓ. El sync de Sent puede tardar
  // hasta 8s (Gmail indexa con delay) — bloquear la respuesta hacía que
  // el cliente viera "Error" si el navegador timeouteaba el fetch.
  //
  // Disparamos el sync en background con setImmediate. El cliente recarga
  // /messages a los 1-2s y ya ve el mensaje (gracias al sync incremental).
  setImmediate(async () => {
    try {
      const { syncAccountSent } = await import("@/lib/unibox-sync");
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2500));
        const n = await syncAccountSent(id, acc.id).catch(() => 0);
        if (n > 0) {
          console.log(`[unibox-send] Sent sync OK tras ${attempt + 1} intento(s)`);
          break;
        }
      }
    } catch (e: any) {
      console.warn(`[unibox-send] background Sent sync falló:`, e?.message || e);
    }
  });

  return NextResponse.json({
    ok: true,
    messageId: info.messageId,
  });
}
