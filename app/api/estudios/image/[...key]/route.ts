import { NextRequest, NextResponse } from "next/server";
import { readBlob } from "@/lib/storage";

export const runtime = "nodejs";

/** GET /api/estudios/image/estudios-img/<id>/<uuid>
 *  Sirve una imagen del blob_store. La key llega como wildcard [...key]. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ key: string[] }> }) {
  const { key } = await ctx.params;
  const fullKey = key.join("/");
  const blob = await readBlob(fullKey);
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(blob.data), {
    headers: {
      "Content-Type": blob.mime || "image/png",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
