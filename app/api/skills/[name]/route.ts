import { NextRequest, NextResponse } from "next/server";
import { getSkill } from "@/lib/skills";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const skill = await getSkill(name);
  if (!skill) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ skill });
}
