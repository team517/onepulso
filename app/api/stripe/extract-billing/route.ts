import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/stripe/extract-billing
 * Body: { image: "data:image/png;base64,..." }   o   FormData con file
 * Devuelve los datos de facturación extraídos.
 */
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY" }, { status: 500 });
  }

  try {
    let imageData: string | null = null;
    let mediaType: string = "image/png";

    const ct = req.headers.get("content-type") || "";

    if (ct.includes("application/json")) {
      const body = await req.json();
      if (body.image) {
        // Formato esperado: data:image/png;base64,XXX
        const m = String(body.image).match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (m) {
          mediaType = m[1];
          imageData = m[2];
        } else {
          imageData = String(body.image);
        }
      }
      if (body.text) {
        // Modo texto puro (extraer de un texto pegado, no imagen)
        return await extractFromText(body.text);
      }
    } else if (ct.includes("multipart/form-data")) {
      const fd = await req.formData();
      const file = fd.get("file") as File | null;
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer());
        imageData = buf.toString("base64");
        mediaType = file.type || "image/png";
      }
    }

    if (!imageData) {
      return NextResponse.json({ error: "Falta imagen" }, { status: 400 });
    }

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType as any, data: imageData },
            },
            {
              type: "text",
              text: EXTRACTION_PROMPT,
            },
          ],
        },
      ],
    });

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => (b as any).text)
      .join("\n");

    const json = parseFirstJson(text);
    if (!json) {
      return NextResponse.json({ error: "No se pudieron extraer datos", raw: text }, { status: 422 });
    }

    return NextResponse.json({ extracted: json });
  } catch (e: any) {
    console.error("[extract-billing]", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function extractFromText(text: string) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const response = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `${EXTRACTION_PROMPT}\n\nTexto a analizar:\n"""\n${text.slice(0, 4000)}\n"""`,
      },
    ],
  });

  const out = response.content
    .filter(b => b.type === "text")
    .map(b => (b as any).text)
    .join("\n");

  const json = parseFirstJson(out);
  if (!json) {
    return NextResponse.json({ error: "No se pudieron extraer datos", raw: out }, { status: 422 });
  }
  return NextResponse.json({ extracted: json });
}

function parseFirstJson(text: string): any | null {
  // Buscar bloque JSON ```json ... ``` o el primer { } del texto
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

const EXTRACTION_PROMPT = `Eres un asistente que extrae datos de facturación.
Analiza la imagen/texto y devuelve un JSON con la información del cliente.

Formato exacto (usa null si no se encuentra el campo):
{
  "name": "Nombre completo o razón social",
  "email": "email@dominio.com",
  "phone": "+34 600 000 000 o null",
  "tax_id": "NIF/CIF/VAT (ej. ESB12345678) o null",
  "tax_type": "eu_vat | es_cif | otra | null",
  "address": {
    "line1": "Calle y número",
    "line2": "Piso/puerta o null",
    "city": "Ciudad",
    "postal_code": "Código postal",
    "state": "Provincia o null",
    "country": "Código ISO 2 letras (ES, FR, etc) — España = ES por defecto"
  }
}

Reglas:
- Si el documento parece español/europeo y hay un NIF/CIF, normaliza tax_id a mayúsculas sin espacios.
- Para empresas españolas con CIF (empieza por A/B), usa "tax_type": "es_cif".
- Para particulares con NIF, "tax_type": "eu_vat" si es válido, si no null.
- Para país, devuelve siempre el código ISO de 2 letras en mayúsculas.
- NO inventes datos. Si un campo no está, ponlo como null.

Devuelve SOLO el JSON, sin explicación.`;
