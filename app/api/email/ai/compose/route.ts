import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { memoryAsContext } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/email/ai/compose
 * Body: {
 *   to: string,
 *   contact_name?: string,
 *   contact_context?: string,
 *   objective?: string,
 *   tone?: string,
 *   topic?: string,            // sobre qué quieres hablarle
 *   include_subject?: boolean, // si true, devuelve también un subject sugerido
 * }
 * Devuelve { subject?: string, body_html: string }
 */
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY" }, { status: 500 });
  }
  try {
    const body = await req.json();
    const memory = await memoryAsContext();

    const personalization: string[] = [];
    if (body.contact_name) personalization.push(`Contacto: ${body.contact_name}`);
    if (body.contact_context) personalization.push(`Contexto del contacto:\n${body.contact_context}`);
    if (body.tone) personalization.push(`TONO: ${body.tone}`);
    if (body.objective) personalization.push(`OBJETIVO: ${body.objective}`);
    if (body.topic) personalization.push(`TEMA / mensaje a comunicar:\n${body.topic}`);

    const wantSubject = body.include_subject !== false;

    const system = `Eres Xavi (onepulso). Vas a redactar el PRIMER email de un cold-outreach a un prospect.

REGLAS:
- Castellano España.
- Tono según TONO; por defecto: directo, personal, sin floritura. Sin emojis. Sin "estimado".
- Frases cortas. Máximo 5-6 párrafos.
- Empieza por algo personal/relevante (no "Espero que estés bien").
- Cierra con CTA claro alineado con el OBJETIVO.
- Firma: <p>Un saludo,<br>Xavi</p>
- HTML simple: <p>, <strong>. Sin tablas ni estilos inline.

OUTPUT: ${wantSubject
  ? 'JSON puro: { "subject": "asunto corto y potente", "body_html": "<p>...</p>" }'
  : 'Solo el body HTML, sin meta-comentarios'}`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000 });
    const r = await client.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 1500,
      system,
      messages: [
        {
          role: "user",
          content: `MEMORIA:\n${memory}\n\n${personalization.join("\n\n")}\n\nDestinatario: ${body.to}\n\nRedacta el primer email.`,
        },
      ],
    });

    const out = r.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

    if (wantSubject) {
      const clean = out.replace(/^```json\s*|\s*```$/gi, "").trim();
      const start = clean.indexOf("{");
      const end = clean.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(clean.slice(start, end + 1));
          return NextResponse.json({
            subject: parsed.subject || "",
            body_html: parsed.body_html || out,
          });
        } catch {
          return NextResponse.json({ body_html: out });
        }
      }
    }

    return NextResponse.json({ body_html: out });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
