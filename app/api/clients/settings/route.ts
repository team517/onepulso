import { NextRequest, NextResponse } from "next/server";
import { getSmartleadSettings, saveSmartleadSettings, testSmartlead } from "@/lib/smartlead";

export const runtime = "nodejs";

/** GET → estado (si hay key, sin exponerla). */
export async function GET() {
  const s = await getSmartleadSettings();
  return NextResponse.json({ connected: !!s.api_key, api_key_set: !!s.api_key });
}

/** POST { api_key, test? } → guarda la key y opcionalmente la prueba. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const apiKey = String(body.api_key ?? "").trim();
  if (body.test) {
    const r = await testSmartlead(apiKey || (await getSmartleadSettings()).api_key || "");
    return NextResponse.json(r);
  }
  await saveSmartleadSettings({ api_key: apiKey });
  const r = apiKey ? await testSmartlead(apiKey) : { ok: false, error: "key vacía" };
  return NextResponse.json({ saved: true, ...r });
}
