import { NextResponse } from "next/server";
import { readEmailConfig, saveEmailConfig } from "@/lib/email-config";

export const runtime = "nodejs";

/** GET — estado actual del relay */
export async function GET() {
  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    email: cfg.email,
    resend_enabled: !!cfg.resend_api_key,
    resend_from: cfg.resend_from || null,
    resend_api_key_preview: cfg.resend_api_key ? cfg.resend_api_key.slice(0, 8) + "…" : null,
  });
}

/** POST — guardar/actualizar la API key de Resend y el "from" */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado. Conecta tu Gmail primero (para IMAP)." }, { status: 400 });

  // Permitir borrar: { resend_api_key: "" } o { clear: true }
  if (body.clear === true || body.resend_api_key === "") {
    delete cfg.resend_api_key;
    delete cfg.resend_from;
    await saveEmailConfig(cfg);
    return NextResponse.json({ ok: true, cleared: true });
  }

  if (typeof body.resend_api_key !== "string" || !body.resend_api_key.startsWith("re_")) {
    return NextResponse.json({ error: "API key inválida. Debe empezar por 're_' (cópiala de https://resend.com/api-keys)." }, { status: 400 });
  }

  cfg.resend_api_key = body.resend_api_key.trim();
  if (typeof body.resend_from === "string" && body.resend_from.trim()) {
    cfg.resend_from = body.resend_from.trim();
  }
  await saveEmailConfig(cfg);
  return NextResponse.json({ ok: true, resend_from: cfg.resend_from || cfg.email });
}

/** POST a /test — envía un correo de prueba via Resend */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const cfg = await readEmailConfig();
  if (!cfg) return NextResponse.json({ error: "Email no conectado" }, { status: 400 });
  if (!cfg.resend_api_key) return NextResponse.json({ error: "Resend no configurado" }, { status: 400 });

  const target = body.to || cfg.email;
  const fromAddr = cfg.resend_from || cfg.email;
  const from = cfg.display_name ? `${cfg.display_name} <${fromAddr}>` : fromAddr;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.resend_api_key}`,
      },
      body: JSON.stringify({
        from,
        to: [target],
        subject: `[onepulso] Resend test · ${new Date().toISOString()}`,
        html: `<p>Si lees esto, <strong>Resend funciona perfecto</strong> en tu instalación.</p><p>From: <code>${from}</code><br>To: <code>${target}</code></p>`,
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ ok: false, status: res.status, error: json?.message || json?.error || JSON.stringify(json) }, { status: 200 });
    }
    return NextResponse.json({ ok: true, id: json.id, sent_to: target });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 200 });
  }
}
