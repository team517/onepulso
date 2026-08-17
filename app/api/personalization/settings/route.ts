import type { NextRequest } from "next/server";
import { withRequestTenant, isOwner } from "@/lib/client-auth";
import { NextResponse } from "next/server";
import { getSettings, saveSettings, testProvider } from "@/lib/ai-providers";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  return withRequestTenant(req as any, async () => {
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

  }) as any;
}

export async function POST(req: Request) {
  return withRequestTenant(req as any, async () => {
  // La config de IA es GLOBAL (clave compartida). Solo el owner puede cambiarla;
  // los clientes usan DeepSeek ya preconectado y no tocan estos ajustes.
  if (!isOwner(req as any)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  }
  const body = await req.json();
  const next = await saveSettings({
    default_provider: body.default_provider,
    deepseek_api_key: body.deepseek_api_key,
    deepseek_model: body.deepseek_model,
    claude_model: body.claude_model,
  });
  return NextResponse.json({ ok: true, default_provider: next.default_provider });

  }) as any;
}

/** PUT /api/personalization/settings → test del proveedor */
export async function PUT(req: Request) {
  return withRequestTenant(req as any, async () => {
  const body = await req.json().catch(() => ({}));
  const provider = body.provider || "claude";
  const result = await testProvider(provider);
  return NextResponse.json(result);

  }) as any;
}
