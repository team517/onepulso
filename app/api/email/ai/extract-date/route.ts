import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "@/lib/env";
import { getThread } from "@/lib/email-threads";

export const runtime = "nodejs";
export const maxDuration = 60;

const SYSTEM = `Extraes intención temporal de un email recibido en español.

Tu único trabajo: dado el texto del prospect, devolver:
- has_date: true/false (si el prospect propone/sugiere una fecha o ventana temporal para retomar)
- date_iso: fecha local interpretada en formato YYYY-MM-DDTHH:mm (ej: "2026-05-15T10:00") o null
- confidence: "high" | "medium" | "low"
- reasoning: 1 frase corta de por qué interpretaste esa fecha
- date_text: el snippet original del prospect que indica la fecha (ej "el jueves", "después de vacaciones")

Reglas:
- Hoy es la fecha que te paso como "today_iso". Calcula relativos a partir de eso.
- "jueves que viene" / "el próximo jueves" → próximo jueves a las 10:00.
- "la semana que viene" / "next week" → lunes próximo a las 10:00.
- "a final de semana" → viernes próximo a las 10:00.
- "después de vacaciones" sin especificar → +14 días, confidence: low.
- "después del verano" → 1 de septiembre 10:00 si es entre junio-agosto, sino confidence: low.
- "en 2 semanas" → +14 días.
- "en X" donde X es un mes → día 15 de ese mes a las 10:00.
- Si no hay nada temporal claro → has_date: false, todo null/vacío.
- Si propone hora específica ("a las 16h") → respétala.

OUTPUT: JSON puro, sin markdown, sin explicación extra. Schema:
{ "has_date": bool, "date_iso": "string|null", "confidence": "high|medium|low", "reasoning": "string", "date_text": "string" }`;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { thread_id, text } = body;
  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });

  let inputText = text as string | undefined;
  if (thread_id && !inputText) {
    const t = await getThread(thread_id);
    if (!t) return NextResponse.json({ error: "thread no encontrado" }, { status: 404 });
    const lastInbound = [...t.messages].reverse().find((m) => m.direction === "inbound");
    if (!lastInbound) return NextResponse.json({ has_date: false, reason: "no inbound message" });
    inputText = (lastInbound.body_text || stripHtml(lastInbound.body_html ?? "")).trim();
  }
  if (!inputText) return NextResponse.json({ error: "text o thread_id requerido" }, { status: 400 });

  const today = new Date();
  const todayIso = today.toISOString();
  const dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][today.getDay()];

  const client = new Anthropic({ apiKey, maxRetries: 6 });
  const r = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `today_iso: ${todayIso}\nday_of_week: ${dow}\n\nTEXTO DEL PROSPECT:\n"""\n${inputText}\n"""`,
      },
    ],
  });
  const out = r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  // Strip markdown fences si los hay
  const clean = out.replace(/^```json\s*|\s*```$/gi, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({ has_date: false, reasoning: "no se pudo parsear", raw: out });
  }
}

function stripHtml(s: string): string {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
