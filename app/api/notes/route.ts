import { NextResponse } from "next/server";
import { listNotes, createNote } from "@/lib/notes";

export const runtime = "nodejs";

export async function GET() {
  const notes = await listNotes();
  return NextResponse.json({ notes });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.content || typeof body.content !== "string") {
    return NextResponse.json({ error: "content requerido" }, { status: 400 });
  }
  const note = await createNote({
    title: body.title,
    content: body.content,
    pinned: body.pinned,
    color: body.color,
    tags: body.tags,
  });
  return NextResponse.json({ note });
}
