import { NextResponse } from "next/server";
import { listPosts, updatePost } from "@/lib/linkedin";

export const runtime = "nodejs";

/**
 * POST /api/linkedin/cancel-overdue
 * Marca como "draft" todos los posts `scheduled` con `scheduled_at` ya pasado.
 * Sirve para frenar de un golpe un backlog acumulado (p. ej. tras un plan
 * mensual que metió fechas pasadas y el scheduler está disparándolos).
 * Los posts NO se borran — quedan como borradores que el usuario puede
 * reprogramar o eliminar manualmente desde la UI.
 */
export async function POST() {
  const posts = await listPosts();
  const now = Date.now();
  let cancelled = 0;
  for (const p of posts) {
    if (p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at).getTime() <= now) {
      await updatePost(p.id, { status: "draft", error: undefined });
      cancelled++;
    }
  }
  return NextResponse.json({ ok: true, cancelled });
}

/** GET: cuenta cuántos hay vencidos sin disparar nada (preview). */
export async function GET() {
  const posts = await listPosts();
  const now = Date.now();
  const overdue = posts.filter(
    (p) => p.status === "scheduled" && p.scheduled_at && new Date(p.scheduled_at).getTime() <= now
  );
  return NextResponse.json({
    overdue_count: overdue.length,
    overdue: overdue.slice(0, 20).map((p) => ({
      id: p.id,
      scheduled_at: p.scheduled_at,
      preview: p.text.slice(0, 80),
    })),
  });
}
