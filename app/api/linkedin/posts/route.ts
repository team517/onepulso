import { NextRequest, NextResponse } from "next/server";
import { listPosts, createPost, uploadImage } from "@/lib/linkedin";
import { promises as fs } from "fs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const posts = await listPosts();
  return NextResponse.json({ posts });
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const text = String(fd.get("text") ?? "");
    const visibility = String(fd.get("visibility") ?? "PUBLIC") as "PUBLIC" | "CONNECTIONS";
    const scheduledAt = fd.get("scheduled_at") ? String(fd.get("scheduled_at")) : undefined;
    const file = fd.get("image");
    let image_path: string | undefined;
    if (file && typeof file !== "string") {
      const buf = Buffer.from(await file.arrayBuffer());
      image_path = await uploadImage(buf);
    }
    const post = await createPost({ text, visibility, scheduled_at: scheduledAt, image_path });
    return NextResponse.json({ post });
  }
  const body = await req.json();
  const post = await createPost(body);
  return NextResponse.json({ post });
}
