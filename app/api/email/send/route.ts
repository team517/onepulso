import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { sendEmail } from "@/lib/email-send";
import { readEmailConfig } from "@/lib/email-config";
import {
  appendMessage,
  createThread,
  getThread,
  findThreadBySubjectAndParticipant,
  updateThread,
} from "@/lib/email-threads";

export const runtime = "nodejs";
export const maxDuration = 120;

const ATTACH_DIR = path.join(process.cwd(), "data", "email-attachments");

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  let to = "";
  let subject = "";
  let body_html = "";
  let thread_id: string | undefined;
  const attachments: Array<{ filename: string; path: string }> = [];

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    to = String(fd.get("to") ?? "");
    subject = String(fd.get("subject") ?? "");
    body_html = String(fd.get("body_html") ?? "");
    thread_id = (fd.get("thread_id") as string) || undefined;

    await fs.mkdir(ATTACH_DIR, { recursive: true });
    const files = fd.getAll("attachments");
    for (const file of files) {
      if (typeof file === "string") continue;
      const buf = Buffer.from(await file.arrayBuffer());
      const fp = path.join(ATTACH_DIR, `${randomUUID()}__${file.name}`);
      await fs.writeFile(fp, buf);
      attachments.push({ filename: file.name, path: fp });
    }
  } else {
    const j = await req.json();
    to = j.to;
    subject = j.subject;
    body_html = j.body_html;
    thread_id = j.thread_id;
  }

  if (!to || !subject || !body_html) {
    return NextResponse.json({ error: "to, subject y body_html requeridos" }, { status: 400 });
  }

  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });

  // Threading: si reply, obtener message-ids del último inbound del thread
  let in_reply_to: string | undefined;
  let references: string[] | undefined;
  let thread = thread_id ? await getThread(thread_id) : null;
  if (thread) {
    const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
    if (lastInbound?.message_id) {
      in_reply_to = lastInbound.message_id;
      references = [...(lastInbound.references ?? []), lastInbound.message_id];
    }
  } else {
    // si no hay thread, intenta encontrar uno existente
    const existing = await findThreadBySubjectAndParticipant(subject, to);
    if (existing) thread = existing;
  }

  let info;
  try {
    info = await sendEmail({
      to,
      subject: thread ? subject : subject, // mantener el subject que pase
      body_html,
      attachments,
      in_reply_to,
      references,
    });
  } catch (e: any) {
    return NextResponse.json({ error: `Envío falló: ${e.message}` }, { status: 500 });
  }

  // Si no había thread, crearlo
  if (!thread) {
    thread = await createThread({
      subject: subject.replace(/^(re:|fwd?:)\s*/gi, "").trim(),
      participants: [cfg.email, to],
    });
  }

  // Marcar el hilo como "watched" para que aparezca en la lista de seguimientos.
  // El usuario lo está iniciando él mismo, así que es de los que sí quiere ver.
  if (!(thread as any).watched) {
    await updateThread(thread.id, { watched: true } as any);
  }

  await appendMessage(thread.id, {
    direction: "outbound",
    from: cfg.email,
    to: [to],
    subject,
    body_html,
    message_id: info.messageId,
    in_reply_to,
    references,
    attachments: attachments.map((a) => ({ filename: a.filename, path: a.path })),
    date: new Date().toISOString(),
  });

  return NextResponse.json({ thread_id: thread.id, message_id: info.messageId });
}
