import { NextResponse } from "next/server";
import { listThreads } from "@/lib/email-threads";
import { readEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";

export type ThreadDynamicStatus =
  | "han_respondido" // último mensaje es inbound, esperan tu respuesta
  | "esperando" // último mensaje es outbound, sin reply aún
  | "en_curso" // intercambio activo en últimos 30 días
  | "cerrado" // marcado closed manualmente
  | "obsoleto"; // sin actividad en > 60 días

function computeStatus(t: any): ThreadDynamicStatus {
  if (t.status === "closed") return "cerrado";
  const msgs = t.messages ?? [];
  if (msgs.length === 0) return "esperando";
  const last = msgs[msgs.length - 1];
  const lastDate = new Date(last.date).getTime();
  const days = (Date.now() - lastDate) / 86400000;
  if (days > 60) return "obsoleto";
  if (last.direction === "inbound") return "han_respondido";
  // último es outbound
  return "esperando";
}

export async function GET() {
  const all = await listThreads();
  const cfg = await readEmailConfig();
  const myEmail = (cfg?.email ?? "").toLowerCase();

  // Solo threads donde el usuario ha interactuado:
  //  - Enviado al menos un mensaje (outbound), O
  //  - Marcado como "watched" (importado vía búsqueda, abierto manualmente, etc.)
  const filtered = all.filter((t) =>
    (t as any).watched === true || t.messages.some((m) => m.direction === "outbound")
  );

  return NextResponse.json({
    threads: filtered.map((t) => {
      const otherParticipants = t.participants.filter((p) => p.toLowerCase() !== myEmail);
      const lastMsg = t.messages[t.messages.length - 1];
      return {
        id: t.id,
        subject: t.subject,
        participants: t.participants,
        contact_email: otherParticipants[0] ?? t.participants[0],
        contact_name: extractName(otherParticipants[0] ?? ""),
        message_count: t.messages.length,
        last_inbound_at: t.last_inbound_at,
        last_outbound_at: t.last_outbound_at,
        last_direction: lastMsg?.direction,
        last_date: lastMsg?.date,
        status: t.status,
        dynamic_status: computeStatus(t),
        followups_count: t.followups.length,
        followups_pending: t.followups.filter((f) => f.status === "scheduled").length,
        preview: lastMsg?.body_text?.slice(0, 140) ?? stripHtml(lastMsg?.body_html ?? "").slice(0, 140),
        updated_at: t.updated_at,
      };
    }),
  });
}

function stripHtml(s: string): string {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function extractName(email: string): string {
  // "Nombre Apellido <foo@bar.com>" → "Nombre Apellido"
  const m = email.match(/^"?([^"<]+)"?\s*</);
  if (m) return m[1].trim();
  // foo.bar@dominio.com → Foo Bar
  const local = email.split("@")[0] ?? email;
  return local
    .replace(/[._-]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
