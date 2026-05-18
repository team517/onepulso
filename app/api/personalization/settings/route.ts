import { NextResponse } from "next/server";
import { getSettings, saveSettings, testProvider } from "@/lib/ai-providers";

export const runtime = "nodejs";

export async function GET() {
  const s = await getSettings();
  // Enmascarar la API key de DeepSeek
  const masked = s.deepseek_api_key
    ? s.deepseek_api_key.slice(0, 6) + "•".repeat(Math.max(0, s.deepseek_api_key.length - 10)) + s.deepseek_api_key.slice(-4)
    : null;
  return NextResponse.json({
    default_provider: s.default_provider,
    deepseek_api_key_masked: masked,
    deepseek_api_key_present: !!s.deepseek_api_key,
    deepseek_model: s.deepseek_model,
    claude_model: s.claude_model,
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const next = await saveSettings({
    default_provider: body.default_provider,
    deepseek_api_key: body.deepseek_api_key,
    deepseek_model: body.deepseek_model,
    claude_model: body.claude_model,
  });
  return NextResponse.json({ ok: true, default_provider: next.default_provider });
}

/** PUT /api/personalization/settings → test del proveedor */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const provider = body.provider || "claude";
  const result = await testProvider(provider);
  return NextResponse.json(result);
}
