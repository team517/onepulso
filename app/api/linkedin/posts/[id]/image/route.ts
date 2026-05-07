import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import { listPosts } from "@/lib/linkedin";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const all = await listPosts();
  const post = all.find((p) => p.id === id);
  if (!post || !post.image_path) {
    return NextResponse.json({ error: "no image" }, { status: 404 });
  }
  try {
    const buf = await fs.readFile(post.image_path);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "image file not found" }, { status: 404 });
  }
}
