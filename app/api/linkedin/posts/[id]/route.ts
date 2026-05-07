import { NextRequest, NextResponse } from "next/server";
import { updatePost, deletePost, uploadImage } from "@/lib/linkedin";
import { promises as fs } from "fs";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ct = req.headers.get("content-type") ?? "";

  let patch: any = {};
  let removeImage = false;
  let newImageBuffer: Buffer | null = null;

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    if (fd.has("text")) patch.text = String(fd.get("text"));
    if (fd.has("visibility")) patch.visibility = String(fd.get("visibility")) as "PUBLIC" | "CONNECTIONS";
    if (fd.has("scheduled_at")) {
      const v = String(fd.get("scheduled_at"));
      patch.scheduled_at = v || undefined;
      patch.status = v ? "scheduled" : "draft";
    }
    if (fd.get("remove_image") === "1") removeImage = true;
    const file = fd.get("image");
    if (file && typeof file !== "string") {
      newImageBuffer = Buffer.from(await file.arrayBuffer());
    }
  } else {
    patch = await req.json();
  }

  if (newImageBuffer) {
    const path = await uploadImage(newImageBuffer);
    patch.image_path = path;
  } else if (removeImage) {
    patch.image_path = undefined;
  }

  const updated = await updatePost(id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ post: updated });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deletePost(id);
  return NextResponse.json({ ok: true });
}

// Endpoint extra para servir la imagen guardada localmente
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return NextResponse.json({ error: "not implemented for GET on this route" }, { status: 405 });
}
