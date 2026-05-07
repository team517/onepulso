import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "@/lib/env";
import { memoryAsContext } from "@/lib/memory";
import { getThread } from "@/lib/email-threads";

export const runtime = "nodejs";
export const maxDuration = 90;

const SYSTEM = `Eres Xavi (onepulso), agencia de lead generation B2B. Estás respondiendo a un hilo de email real con un prospect.

OBJETIVO: avanzar el hilo hacia una reunión / cierre, manteniendo un tono natural y profesional. NO sonar a SDR robótico.

REGLAS DE RESPUESTA:
- Castellano España.
- Tono directo, personal, sin floritura. Como un colega senior.
- Sin emojis. Sin "estimado", sin "saludos cordiales".
- Lee TODO el hilo y responde a lo que el prospect ha dicho concretamente, no a un genérico.
- Si el prospect pregunta algo → respóndelo claramente.
- Si plantea una objeción → trátala con un dato/caso concreto.
- Si pide más info → da info útil + propón 10 min de call.
- Si dice "el jueves", "la semana que viene", "después de vacaciones" → reconoce la fecha y propón concretarla.
- Frases cortas. Bloques cortos. <p> entre bloques (HTML).
- Negritas <strong> en 1-2 puntos clave si aporta.
- Cierra con CTA claro o pregunta concreta. Sin "qué opinas".
- Firma: <p>Un saludo,<br>Xavi</p>

OUTPUT: HTML del cuerpo del email, sin <html>/<head>, solo los <p>. Sin comillas alrededor. Sin meta-comentarios.`;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { thread_id, hint } = body;
  if (!thread_id) return NextResponse.json({ error: "thread_id requerido" }, { status: 400 });
  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });

  const thread = await getThread(thread_id);
  if (!thread) return NextResponse.json({ error: "thread no encontrado" }, { status: 404 });

  const memory = await memoryAsContext();
  const transcript = thread.messages
    .map((m) => {
      const who = m.direction === "outbound" ? "Xavi (yo)" : `Prospect (${m.from})`;
      const text = (m.body_text || stripHtml(m.body_html ?? "")).trim();
      return `--- ${who} | ${m.date}\n[Subject: ${m.subject}]\n${text}`;
    })
    .join("\n\n");

  const userMsg = `MEMORIA DEL USUARIO (cómo hablo, qué vendo, casos):
${memory}

HILO COMPLETO DEL EMAIL (cronológico):
${transcript}

${hint ? `\nINSTRUCCIÓN ADICIONAL del usuario para esta respuesta: ${hint}\n` : ""}
Redacta la siguiente respuesta de Xavi como HTML del body (<p>...</p> por bloque). Solo el body, nada más.`;

  const client = new Anthropic({ apiKey, maxRetries: 3, timeout: 120_000 });
  const r = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });
  const text = r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  return NextResponse.json({ body_html: text });
}

function stripHtml(s: string): string {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
