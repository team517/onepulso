import { NextRequest, NextResponse } from "next/server";
import { envVar } from "@/lib/env";
import { setCredential, clearCredential, mask, isKnown, CredentialKey } from "@/lib/credentials";

export const runtime = "nodejs";

const KEYS: CredentialKey[] = [
  "ANTHROPIC_API_KEY",
  "INSTANTLY_API_KEY",
  "OPENAI_API_KEY",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
];

export async function GET() {
  const out: Record<string, { configured: boolean; masked: string }> = {};
  for (const k of KEYS) {
    const v = envVar(k);
    out[k] = { configured: !!v, masked: mask(v) };
  }
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const updates: Record<string, string> = body;
  const applied: string[] = [];
  for (const [k, v] of Object.entries(updates)) {
    if (!isKnown(k)) continue;
    if (typeof v !== "string") continue;
    if (v.trim()) {
      await setCredential(k as CredentialKey, v.trim());
    } else {
      await clearCredential(k as CredentialKey);
    }
    applied.push(k);
  }
  return NextResponse.json({ ok: true, applied });
}
