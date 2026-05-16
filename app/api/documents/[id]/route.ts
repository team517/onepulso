import { NextResponse } from "next/server";
import { readDocument, updateDocument, deleteDocument } from "@/lib/documents";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(_req.url);
  const download = url.searchParams.get("download") === "1";

  const result = await readDocument(id);
  if (!result) return NextResponse.json({ error: "no encontrado" }, { status: 404 });

  // Si pasa ?meta=1 devuelve solo metadata
  if (url.searchParams.get("meta") === "1") {
    return NextResponse.json({ meta: result.meta });
  }

  const filenameEncoded = encodeURIComponent(result.meta.filename);
  return new NextResponse(new Uint8Array(result.data), {
    headers: {
      "Content-Type": result.meta.mime,
      "Content-Length": String(result.meta.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${filenameEncoded}`,
      "Cache-Control": "private, max-age=300",
    },
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const doc = await updateDocument(id, body);
  if (!doc) return NextResponse.json({ error: "no encontrado" }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await deleteDocument(id);
  return NextResponse.json({ ok: true });
}
