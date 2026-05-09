import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "@/lib/env";
import { randomUUID } from "crypto";
import { writeBlob } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 180;

const PROMPT_BUILDER_SYSTEM = `Convierte el texto de un post de LinkedIn en un image prompt cinematográfico, conceptual y visualmente potente para DALL-E 3.

REGLAS:
- Output en inglés (DALL-E rinde mejor en inglés).
- Estilo visual: photo-realistic cinematic, editorial, conceptual / metaphorical. NO mockups obvios. NO texto en la imagen. NO logos.
- 1024x1024 cuadrado.
- Capta la idea o emoción central del post, no detalles literales.
- Incluye composición, iluminación y paleta concreta.
- 2-3 frases máximo. Devuelve SOLO el prompt, sin comillas ni explicación.

Ejemplos buenos:
- "Wide cinematic shot of a single chess king casting a long shadow at sunset, golden hour, shallow depth of field, muted earthy palette, photographic, 8k editorial."
- "Aerial macro shot of waves breaking on dark volcanic sand, slow shutter blur, dramatic blue-grey tones, conceptual mood of patience."`;

async function buildPromptFromPost(postText: string, extra: string, anthropicKey: string): Promise<string> {
  const client = new Anthropic({ apiKey: anthropicKey });
  const userMsg = `Texto del post:\n"""\n${postText}\n"""${
    extra ? `\n\nGuía adicional del usuario (estilo, color, tono visual):\n${extra}` : ""
  }\n\nDevuelve solo el image prompt en inglés.`;
  const r = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: PROMPT_BUILDER_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });
  return r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join(" ")
    .trim();
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    prompt: rawPrompt,
    post_text,
    extra,
    size,
  }: { prompt?: string; post_text?: string; extra?: string; size?: string } = body;

  if (!rawPrompt && !post_text) {
    return NextResponse.json({ error: "prompt o post_text requerido" }, { status: 400 });
  }

  const openaiKey = envVar("OPENAI_API_KEY");
  if (!openaiKey) {
    return NextResponse.json(
      {
        error:
          "Falta OPENAI_API_KEY en .env.local. Crea una en platform.openai.com → API Keys (necesita saldo). DALL-E 3 ~$0.04/imagen.",
      },
      { status: 500 }
    );
  }

  // Si viene post_text, derivar prompt con Claude
  let finalPrompt = rawPrompt ?? "";
  let derived = false;
  if (post_text && post_text.trim()) {
    const anthropicKey = envVar("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY missing — necesaria para derivar el image prompt del texto del post." },
        { status: 500 }
      );
    }
    try {
      finalPrompt = await buildPromptFromPost(post_text, extra ?? "", anthropicKey);
      derived = true;
    } catch (e: any) {
      return NextResponse.json({ error: `Claude prompt builder falló: ${e.message}` }, { status: 500 });
    }
  }

  if (!finalPrompt.trim()) {
    return NextResponse.json({ error: "No se pudo construir el prompt" }, { status: 400 });
  }

  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt: finalPrompt,
      n: 1,
      size: size ?? "1024x1024",
      response_format: "b64_json",
      quality: "standard",
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    return NextResponse.json(
      { error: `OpenAI: ${data.error?.message ?? JSON.stringify(data).slice(0, 300)}` },
      { status: 500 }
    );
  }
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) return NextResponse.json({ error: "OpenAI no devolvió imagen" }, { status: 500 });

  // Guardar en blob storage (Postgres en prod, fs en dev) para URL persistente
  let imageUrl: string | null = null;
  let filename: string | null = null;
  try {
    filename = `draft-${randomUUID()}.png`;
    await writeBlob(`linkedin-images/${filename}`, Buffer.from(b64, "base64"), "image/png");
    imageUrl = `/api/linkedin/draft-image/${filename}`;
  } catch (e: any) {
    console.warn("[linkedin/generate-image] no se pudo guardar:", e.message);
  }

  return NextResponse.json({
    image_base64: b64,
    image_url: imageUrl,
    image_filename: filename,
    mime: "image/png",
    image_prompt_used: finalPrompt,
    derived_from_post_text: derived,
    revised_prompt: data.data[0].revised_prompt,
  });
}
