import { NextRequest, NextResponse } from "next/server";
import { listMemory, saveMemory, deleteMemory } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  const entries = await listMemory();
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const e = await saveMemory(body);
  return NextResponse.json({ entry: e });
}

export async function DELETE(req: NextRequest) {
  const { slug } = await req.json();
  await deleteMemory(slug);
  return NextResponse.json({ ok: true });
}
