import { NextRequest, NextResponse } from "next/server";
import { getClient, getClientBySlug, listStages, progressPercent } from "@/lib/onboarding";

/**
 * Devuelve el estado actual del cliente autenticado por la cookie del slug.
 * GET /api/onboarding-client/me?slug=acme
 */
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get("slug") || "").toLowerCase().trim();
  if (!slug) return NextResponse.json({ error: "slug requerido" }, { status: 400 });

  const cookieName = `onboarding_client_${slug}`;
  const cookieValue = req.cookies.get(cookieName)?.value;
  if (!cookieValue) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const bySlug = await getClientBySlug(slug);
  if (!bySlug || bySlug.id !== cookieValue) {
    return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
  }

  const client = await getClient(cookieValue);
  if (!client) return NextResponse.json({ error: "No encontrado" }, { status: 404 });

  const stages = await listStages();
  const percent = progressPercent(client, stages);

  return NextResponse.json({
    client: {
      id: client.id,
      name: client.name,
      slug: client.slug,
      project_title: client.project_title,
      contact_name: client.contact_name,
      status_message: client.status_message,
      completed_stage_ids: client.completed_stage_ids,
      current_stage_id: client.current_stage_id,
      updated_at: client.updated_at,
    },
    stages,
    percent,
  });
}
