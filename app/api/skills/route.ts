import { NextRequest, NextResponse } from "next/server";
import { installSkill } from "@/lib/skills-installer";
import { listSkills } from "@/lib/skills";
import { addToScope, removeFromScope, Scope } from "@/lib/skill-scopes";

export const runtime = "nodejs";
export const maxDuration = 240;

function parseScope(s: string | null): Scope | undefined {
  if (s === "campaigns" || s === "linkedin") return s;
  return undefined;
}

export async function GET(req: NextRequest) {
  const scope = parseScope(req.nextUrl.searchParams.get("scope"));
  const skills = await listSkills(scope);
  return NextResponse.json({ skills, scope: scope ?? "all" });
}

export async function POST(req: NextRequest) {
  const { identifier, scope } = await req.json();
  if (!identifier || typeof identifier !== "string") {
    return NextResponse.json({ error: "identifier missing" }, { status: 400 });
  }
  const scopeVal = parseScope(scope);
  try {
    const result = await installSkill(identifier);
    if (scopeVal && result.installed.length) {
      for (const s of result.installed) {
        await addToScope(s.name, scopeVal);
      }
    }
    if (result.error && result.installed.length === 0) {
      return NextResponse.json(result, { status: 422 });
    }
    return NextResponse.json({ ...result, scope: scopeVal ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  // remove a skill from a scope (no borra el archivo, solo la asociación)
  const { name, scope } = await req.json();
  const scopeVal = parseScope(scope);
  if (!name || !scopeVal) return NextResponse.json({ error: "name+scope required" }, { status: 400 });
  await removeFromScope(name, scopeVal);
  return NextResponse.json({ ok: true });
}
