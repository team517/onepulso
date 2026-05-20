import { NextRequest, NextResponse } from "next/server";
import { getPost, publishPost, updatePost, verifyPublishOnError } from "@/lib/linkedin";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Publica un post manualmente.
 *
 * Reglas anti-duplicado:
 *  - Refusal si ya está "published" o "publishing".
 *  - Refusal si se intentó hace < 60s (cooldown contra doble clic).
 *  - Si la petición a LinkedIn falla, verificamos si realmente NO se publicó
 *    (verifyPublishOnError). Si encontramos el post → marcamos publicado.
 */
export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const post = await getPost(id);
  if (!post) return NextResponse.json({ error: "Post no encontrado" }, { status: 404 });

  if (post.status === "published") {
    return NextResponse.json({ error: "Este post ya está publicado", post }, { status: 409 });
  }
  if (post.status === "publishing") {
    return NextResponse.json({ error: "Hay otra publicación en curso para este post — espera unos segundos", post }, { status: 409 });
  }
  if (post.last_attempt_at) {
    const elapsed = Date.now() - new Date(post.last_attempt_at).getTime();
    if (elapsed < 60_000) {
      return NextResponse.json(
        { error: `Espera ${Math.ceil((60_000 - elapsed) / 1000)}s antes de volver a intentar (cooldown anti-duplicado)`, post },
        { status: 429 }
      );
    }
  }

  const attemptStart = Date.now();
  await updatePost(id, {
    status: "publishing",
    last_attempt_at: new Date(attemptStart).toISOString(),
  });
  try {
    const { urn } = await publishPost(post);
    const updated = await updatePost(id, {
      status: "published",
      published_at: new Date().toISOString(),
      linkedin_post_urn: urn,
      error: undefined,
    });
    return NextResponse.json({ post: updated });
  } catch (e: any) {
    // Verificación anti-duplicado tras error de red
    const verifiedUrn = await verifyPublishOnError(post, attemptStart);
    if (verifiedUrn) {
      const updated = await updatePost(id, {
        status: "published",
        published_at: new Date(attemptStart).toISOString(),
        linkedin_post_urn: verifiedUrn,
        error: undefined,
      });
      return NextResponse.json({ post: updated, recovered: true });
    }
    const updated = await updatePost(id, { status: "failed", error: e.message });
    return NextResponse.json({ error: e.message, post: updated }, { status: 500 });
  }
}
