import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "@/lib/env";
import { memoryAsContext } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM = `Generas secuencias de email follow-up para Xavi (onepulso, lead generation B2B).

Te da: una descripción del propósito + datos del prospect. Tú devuelves un JSON con steps[] de la secuencia.

REGLAS DE CADA STEP:
- delay_days: días desde el step anterior (o desde el envío inicial para el step 1).
- body_html: HTML con <p> en cada bloque, <strong> en 2-3 palabras clave, firma "Un saludo,<br>Xavi". Sin emojis.
- send_if_no_reply: true por defecto (cancelar si han respondido).
- note: 1 frase corta describiendo el propósito.

ESTRATEGIA:
- 3-4 steps típicamente.
- Step 1 (3 días): bump suave + recordar el gancho personalizado.
- Step 2 (4 días): caso real con número o pregunta de cualificación.
- Step 3 (5 días): breakup invitando a responder cuando lo retomen.
- Si el usuario describe ramas condicionales ("si dice X, mandar Y") → ignora la condición y genera la rama del "no responde". Las ramas por contenido se gestionan con respuestas IA, no con secuencias programadas.

Castellano España. Tono directo, profesional, sin floritura.

OUTPUT: JSON puro sin markdown:
{
  "name": "string corto",
  "description": "string",
  "steps": [
    {"delay_days": 3, "body_html": "<p>...</p>", "send_if_no_reply": true, "note": "..."},
    ...
  ]
}`;

export async function POST(req: NextRequest) {
  const { description } = await req.json();
  if (!description) return NextResponse.json({ error: "description requerida" }, { status: 400 });
  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });

  const memory = await memoryAsContext();
  const userMsg = `MEMORIA DEL USUARIO (tono, framework, casos):
${memory}

DESCRIPCIÓN DE LA SECUENCIA QUE QUIERE GENERAR:
${description}

Devuelve solo el JSON con la secuencia.`;

  const client = new Anthropic({ apiKey, maxRetries: 6, timeout: 120_000 });
  const r = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 6000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });
  const out = r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  const clean = out.replace(/^```json\s*|\s*```$/gi, "").trim();
  try {
    const parsed = JSON.parse(clean);
    return NextResponse.json({ sequence: parsed });
  } catch {
    return NextResponse.json({ error: "no se pudo parsear", raw: out }, { status: 500 });
  }
}
