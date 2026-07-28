import { NextRequest, NextResponse } from "next/server";
import { writeBlob, readBlob } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 30;

const LOGO_KEY = "report-logo";
const MAX = 3 * 1024 * 1024; // 3 MB

/** GET → ¿hay logo? */
export async function GET() {
  const b = await readBlob(LOGO_KEY).catch(() => null);
  return NextResponse.json({ has_logo: !!b, mime: b?.mime || null });
}

/** POST (bytes crudos + cabecera x-mime) → guarda el logo (PNG/JPG). */
export async function POST(req: NextRequest) {
  const mime = req.headers.get("x-mime") || "image/png";
  if (!/^image\/(png|jpe?g)$/i.test(mime)) return NextResponse.json({ error: "Formato no válido (usa PNG o JPG)" }, { status: 400 });
  if (!req.body) return NextResponse.json({ error: "Sin archivo" }, { status: 400 });
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.length; if (total > MAX) return NextResponse.json({ error: "Logo demasiado grande (máx 3 MB)" }, { status: 413 }); }
  }
  const buf = Buffer.concat(chunks, total);
  if (buf.length === 0) return NextResponse.json({ error: "Archivo vacío" }, { status: 400 });
  await writeBlob(LOGO_KEY, buf, mime);
  return NextResponse.json({ ok: true, bytes: buf.length });
}
