import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { listAccounts } from "@/lib/unibox-store";
import { insertSentMessage } from "@/lib/unibox-messages-db";
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
  // Si el cliente ya gestionó la firma (la incluyó o el usuario la
  // desactivó), el servidor NO debe tocarla.
  const signatureHandled = String(form.get("signature_handled") || "") === "1";

  const accs = await listAccounts(id);
  const acc = accs.find((a) => a.id === accountId);
  if (!acc) return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 400 });
  if (!to) return NextResponse.json({ error: "Falta destinatario" }, { status: 400 });

  // Construye un transporter para un puerto concreto con timeouts
  // generosos (IONOS a veces tarda en el handshake).
  function makeTransporter(p: number) {
    const sec = p === 465;
    return nodemailer.createTransport({
      host: acc!.smtp_host,
      port: p,
      secure: sec,
      auth: { user: acc!.smtp_user || acc!.email, pass: acc!.smtp_pass },
      tls: { rejectUnauthorized: false },
      requireTLS: !sec && p === 587,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
    } as any);
  }

  const primaryPort = acc.smtp_port || 587;
  const port = primaryPort;

  const files = form.getAll("attachments") as File[];
  const attachments = await Promise.all(
    files.map(async (f) => ({
      filename: f.name,
      content: Buffer.from(await f.arrayBuffer()),
    }))
  );

  const hasHtml = /<[a-z][\s\S]*>/i.test(body);
  let html = hasHtml ? body : body.replace(/\n/g, "<br>");

  // AUTO-FIRMA: solo si el cliente NO la gestionó ya. Para envíos
  // automáticos (reminders, follow-ups) o clientes viejos que no mandan
  // el flag signature_handled, aplicamos la firma con detección por huella.
  if (!signatureHandled && acc.signature_html && acc.signature_html.trim().length > 0) {
    const sigPlain = acc.signature_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const sigSample = sigPlain.slice(0, 40);
    const bodyPlain = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const alreadyHasSig = sigSample && bodyPlain.includes(sigSample);
    if (!alreadyHasSig) {
      html = html + `\n<br><br>\n${acc.signature_html}`;
    }
  }

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

  // ENVÍO con reintentos: intentamos el puerto configurado y, si falla
  // por timeout/conexión, probamos el puerto alternativo (587↔465).
  // Muchas cuentas IONOS funcionan en ambos pero uno puede estar bloqueado
  // o lento en un momento dado.
  const portsToTry: number[] = [primaryPort];
  const alt = primaryPort === 587 ? 465 : 587;
  portsToTry.push(alt);

  let info: any = null;
  let lastError: any = null;
  for (let i = 0; i < portsToTry.length; i++) {
    const p = portsToTry[i];
    const transporter = makeTransporter(p);
    try {
      info = await transporter.sendMail(mail);
      if (i > 0) {
        console.log(`[unibox-send] ${acc.email}: enviado por puerto alternativo ${p}`);
      }
      try { transporter.close?.(); } catch {}
      break;
    } catch (e: any) {
      lastError = e;
      try { transporter.close?.(); } catch {}
      const msg = String(e?.message || e).toLowerCase();
      const isConnIssue =
        msg.includes("timeout") || msg.includes("econnrefused") ||
        msg.includes("etimedout") || msg.includes("greeting") ||
        msg.includes("econnreset") || msg.includes("socket") ||
        msg.includes("connection");
      console.warn(`[unibox-send] ${acc.email} puerto ${p} falló: ${e?.message}`);
      // Solo probamos el alternativo si fue problema de conexión, no de auth.
      if (!isConnIssue) break;
    }
  }

  if (!info) {
    const errMsg = String(lastError?.message || lastError || "error desconocido");
    console.error(`[unibox-send] SMTP FALLÓ ${acc.email}: ${errMsg}`);
    // Mensaje de error amigable según el tipo
    let friendly = errMsg;
    const low = errMsg.toLowerCase();
    if (low.includes("invalid login") || low.includes("authentication") || low.includes("535")) {
      friendly = "Credenciales SMTP incorrectas. Revisa usuario/contraseña de la cuenta.";
    } else if (low.includes("timeout") || low.includes("etimedout") || low.includes("greeting")) {
      friendly = "El servidor SMTP no respondió a tiempo. Inténtalo de nuevo en unos segundos.";
    } else if (low.includes("econnrefused")) {
      friendly = "No se pudo conectar al servidor SMTP. Verifica el host y puerto.";
    }
    return NextResponse.json({
      error: friendly,
      detail: errMsg,
      smtp_host: acc.smtp_host,
      smtp_port: primaryPort,
    }, { status: 500 });
  }

  console.log(`[unibox-send] ✓ ${acc.email} → ${to} (${info?.messageId})`);

  // GUARDAR EN ENVIADOS de forma PERMANENTE en la propia bandeja del Unibox,
  // sin depender de que el proveedor copie el mensaje a su carpeta Sent (IONOS
  // y otros NO lo hacen). Así el enviado aparece al instante y no desaparece al
  // recargar. Dedup por message-id con el sync posterior.
  try {
    await insertSentMessage(id, acc.id, {
      messageId: info.messageId || "",
      fromName: displayName,
      fromAddress: acc.email,
      to,
      subject: finalSubject,
      html,
      inReplyTo: normalizedInReplyTo || undefined,
      references: (mail.references as string[]) || [],
      attachments: attachments.map((a: any) => ({ filename: a.filename || "", contentType: "", size: (a.content?.length || 0) })),
      nowMs: Date.now(),
    });
  } catch (e: any) {
    console.warn(`[unibox-send] no se pudo guardar en Enviados (bandeja):`, e?.message || e);
  }

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
