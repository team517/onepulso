import { NextResponse } from "next/server";
import { listThreads } from "@/lib/email-threads";

export const runtime = "nodejs";

/**
 * GET /api/email/followups/calendar
 * Devuelve todos los follow-ups (scheduled + sent) con info del thread
 * para mostrar en una vista de calendario.
 */
export async function GET() {
  try {
    const threads = await listThreads();
    const events: any[] = [];

    for (const t of threads) {
      // Determinar nombre legible del contacto
      const prospect = t.participants.find(p => !/onepulso\.online$/i.test(p))
        || t.participants[0]
        || "Sin contacto";
      const displayName = t.contact_name?.trim() || extractNameFromEmail(prospect) || prospect;

      for (const f of t.followups) {
        events.push({
          id: f.id,
          thread_id: t.id,
          scheduled_at: f.scheduled_at,
          status: f.status,
          origin: f.origin,
          subject: t.subject,
          contact_email: prospect,
          contact_name: displayName,
          contact_context: t.contact_context || "",
          auto_pilot: !!t.auto_pilot,
          body_html: f.body_html,
          sent_at: f.sent_at,
        });
      }
    }

    // Ordenar por fecha ascendente
    events.sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));

    return NextResponse.json({ events });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, events: [] }, { status: 500 });
  }
}

function extractNameFromEmail(email: string): string {
  // Si el email tiene formato "Nombre Apellido <email@x>" extrae el nombre
  const m = email.match(/^([^<]+)<.+>$/);
  if (m) return m[1].trim();
  // De ahmed.smith@empresa.com → Ahmed Smith
  const local = email.split("@")[0];
  return local
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
