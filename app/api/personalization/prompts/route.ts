import type { NextRequest } from "next/server";
import { withRequestTenant } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { listSavedPrompts, createSavedPrompt } from "@/lib/saved-prompts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withRequestTenant(req as any, async () => {
  const prompts = await listSavedPrompts();
  return NextResponse.json({ prompts });

  }) as any;
}

export async function POST(req: Request) {
  return withRequestTenant(req as any, async () => {
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

  }) as any;
}
