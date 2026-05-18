import { NextResponse } from "next/server";
import { listSavedPrompts, createSavedPrompt } from "@/lib/saved-prompts";

export const runtime = "nodejs";

export async function GET() {
  const prompts = await listSavedPrompts();
  return NextResponse.json({ prompts });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name || !body.content) {
    return NextResponse.json({ error: "name y content requeridos" }, { status: 400 });
  }
  const item = await createSavedPrompt({
    name: body.name,
    content: body.content,
    description: body.description,
    provider: body.provider,
    tags: body.tags,
  });
  return NextResponse.json({ prompt: item });
}
