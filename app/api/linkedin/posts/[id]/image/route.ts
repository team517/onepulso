import { NextRequest, NextResponse } from "next/server";
import { listPosts, readImage } from "@/lib/linkedin";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const all = await listPosts();
  const post = all.find((p) => p.id === id);
  if (!post || !post.image_path) {
    return NextResponse.json({ error: "no image" }, { status: 404 });
  }
  const blob = await readImage(post.image_path);
  if (!blob) {
    return NextResponse.json({ error: "image file not found" }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(blob.data), {
    headers: {
      "Content-Type": blob.mime,
      "Cache-Control": "no-cache",
    },
  });
}
