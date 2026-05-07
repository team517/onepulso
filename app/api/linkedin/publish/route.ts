import { NextRequest, NextResponse } from "next/server";
import { listPosts, publishPost, updatePost } from "@/lib/linkedin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { id } = await req.json();
  const all = await listPosts();
  const post = all.find((p) => p.id === id);
  if (!post) return NextResponse.json({ error: "not found" }, { status: 404 });
  await updatePost(id, { status: "publishing" });
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
    const updated = await updatePost(id, { status: "failed", error: e.message });
    return NextResponse.json({ error: e.message, post: updated }, { status: 500 });
  }
}
