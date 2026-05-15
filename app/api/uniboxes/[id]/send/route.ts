import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { listAccounts } from "@/lib/unibox-store";
import { requireAdmin, requireClientForUnibox } from "@/lib/unibox-auth";

export const runtime = "nodejs";

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
  const html = hasHtml ? body : body.replace(/\n/g, "<br>");
  const displayName = [acc.first_name, acc.last_name].filter(Boolean).join(" ") || acc.email;

  const mail: any = {
    from: `"${displayName}" <${acc.email}>`,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject: subject || "(sin asunto)",
    text: body.replace(/<[^>]+>/g, ""),
    html,
    attachments,
  };
  if (inReplyTo) {
    mail.inReplyTo = inReplyTo;
    const refList = (references ? references.split(/\s+/).filter(Boolean) : []);
    if (!refList.includes(inReplyTo)) refList.push(inReplyTo);
    mail.references = refList;
  }

  try {
    const info = await transporter.sendMail(mail);
    return NextResponse.json({ ok: true, messageId: info.messageId });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || String(e) }, { status: 500 });
  }
}
