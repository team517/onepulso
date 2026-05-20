import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "@/lib/env";
import { memoryAsContext } from "@/lib/memory";
import { listSkills, getSkill } from "@/lib/skills";
import { createPost, uploadImage } from "@/lib/linkedin";

export const runtime = "nodejs";
export const maxDuration = 600;

type PlanPost = {
  date_iso: string; // ISO local datetime YYYY-MM-DDTHH:mm
  topic: string;
  text: string;
  image_prompt?: string;
};

const PLAN_SYSTEM = `Eres un planificador estratégico de contenidos LinkedIn B2B.

Tu trabajo: dado un mes, fechas objetivo, memoria del usuario, skills y briefs — diseña un calendario coherente de posts.

# REGLAS DE CONTENIDO

1. VARIEDAD temática a lo largo del mes. Mezcla: opiniones contrarias, lecciones de cliente, datos del sector, mini-casos, preguntas, takeaways operativos. NO agrupes 3 posts del mismo tipo seguidos.
2. Tono y framework de la memoria del usuario (sin emojis salvo indicación, castellano España, directo, sin fluff).
3. Cada post: 700-1400 caracteres incluyendo espacios en blanco.
4. Hook fuerte primera línea (afirmación contraria, dato, observación, pregunta).
5. Cierre con insight o pregunta específica (no "qué opinas").
6. Devuelve EXACTAMENTE el número de posts pedidos, en las fechas exactas que te den.

# FORMATO VISUAL — CRÍTICO

LinkedIn castiga los muros de texto. Cada post debe tener espacios en blanco bien repartidos:

- Hook (primera línea) → SOLO, en su línea
- Línea en blanco
- Contexto/giro → 1 línea
- Línea en blanco
- Desarrollo en mini-bloques de 1-3 frases máximo
- Línea en blanco entre cada bloque
- Cierre → SOLO, en su línea

Frases máximo 20 palabras. Bloques máximo 3 líneas seguidas. Si usas listas: cada ítem en línea propia con "- ", sin emojis ni numeración (salvo que sea imprescindible).

USA SALTOS DE LÍNEA REALES (\\n\\n) en el campo "text". Cada post debe parecer ya formateado para LinkedIn, no un párrafo plano.

Ejemplo de cómo debe verse el campo "text":

"Vendedores B2B: dejad de mandar follow-ups el viernes a las 17h.\\n\\nLo digo después de revisar 12.000 secuencias este año.\\n\\nLos emails enviados viernes tarde caen en el agujero negro del fin de semana.\\nCuando el lead abre el inbox el lunes, tu mensaje está enterrado.\\n\\nReply rate viernes 17-19h: 1.4%.\\nReply rate martes 9-11h: 6.8%.\\n\\n¿Cuántas oportunidades estás enterrando en un lunes?"

# IMÁGENES

Para cada post, sugiere un image_prompt en INGLÉS (cinematic, photo style, 1024x1024) — conceptual / metafórico / editorial, NO mockups, NO texto en la imagen, NO logos.

# OUTPUT

Usa la herramienta submit_plan con el array completo. Cada post["text"] DEBE tener saltos de línea (\\n\\n) entre bloques, no ser un párrafo continuo.`;

const tool: Anthropic.Messages.Tool = {
  name: "submit_plan",
  description: "Envía el plan completo de posts del mes",
  input_schema: {
    type: "object",
    properties: {
      posts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date_iso: { type: "string", description: "YYYY-MM-DDTHH:mm exacto del slot pedido" },
            topic: { type: "string", description: "tema en 3-6 palabras" },
            text: { type: "string", description: "texto completo del post LinkedIn" },
            image_prompt: { type: "string", description: "prompt de imagen en inglés, descriptivo, sin texto" },
          },
          required: ["date_iso", "topic", "text"],
        },
      },
    },
    required: ["posts"],
  },
};

function targetDates(opts: {
  year: number;
  month: number; // 1-12
  daysOfWeek: number[]; // 1=Mon ... 7=Sun
  hour: number;
  minute: number;
  postsPerWeek: number;
}): string[] {
  const result: string[] = [];
  const { year, month, daysOfWeek, hour, minute } = opts;
  const last = new Date(year, month, 0).getDate();
  const targetDows = new Set(daysOfWeek.map((d) => (d === 7 ? 0 : d))); // map ISO to JS dow
  // ANTI-BURST: nunca crear posts con fecha en el pasado. Si lo hiciéramos,
  // el scheduler los detectaría como "vencidos" y los publicaría todos a la
  // vez en el siguiente tick. Margen: 30 min en el futuro mínimo.
  const cutoff = Date.now() + 30 * 60_000;
  for (let d = 1; d <= last; d++) {
    const date = new Date(year, month - 1, d, hour, minute, 0, 0);
    if (date.getTime() < cutoff) continue; // saltar fechas pasadas / inminentes
    if (targetDows.has(date.getDay())) {
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const hh = String(hour).padStart(2, "0");
      const mn = String(minute).padStart(2, "0");
      result.push(`${yyyy}-${mm}-${dd}T${hh}:${mn}`);
    }
  }
  return result;
}

async function generateImage(prompt: string, openaiKey: string): Promise<Buffer | null> {
  const r = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1024x1024",
      response_format: "b64_json",
      quality: "standard",
    }),
  });
  const data = await r.json();
  if (!r.ok || !data.data?.[0]?.b64_json) return null;
  return Buffer.from(data.data[0].b64_json, "base64");
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    year,
    month,
    daysOfWeek = [2, 3, 4], // Mar, Mié, Jue
    hour = 10,
    minute = 0,
    postsPerWeek = 3,
    briefs = "",
    generate_images = false,
  } = body;

  if (!year || !month) {
    return NextResponse.json({ error: "year y month requeridos" }, { status: 400 });
  }

  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });

  const openaiKey = generate_images ? envVar("OPENAI_API_KEY") : "";
  if (generate_images && !openaiKey) {
    return NextResponse.json(
      { error: "Para generar imágenes necesitas OPENAI_API_KEY en .env.local." },
      { status: 400 }
    );
  }

  const allDates = targetDates({ year, month, daysOfWeek, hour, minute, postsPerWeek });
  // Limitar a postsPerWeek * 4-5 semanas según el mes
  const dates = allDates;
  if (dates.length === 0) {
    return NextResponse.json({ error: "Ninguna fecha objetivo en ese mes con esos días/hora." }, { status: 400 });
  }

  // Construir contexto con memoria + skills LinkedIn
  const memory = await memoryAsContext();
  const liSkills = await listSkills("linkedin");
  let skillsBlock = "";
  if (liSkills.length) {
    const fulls = await Promise.all(
      liSkills.map(async (s) => {
        const f = await getSkill(s.name);
        return f ? `### ${f.name}\n${f.content.slice(0, 2500)}` : "";
      })
    );
    skillsBlock = `\n\nSkills LinkedIn instaladas:\n${fulls.filter(Boolean).join("\n\n---\n\n")}`;
  }

  const userPrompt = `Memoria del usuario:
${memory}${skillsBlock}

Briefs opcionales del usuario (temas, ángulos, anclas):
${briefs.trim() || "(sin briefs específicos — tú decides la variedad temática)"}

Fechas objetivo del mes (debes generar EXACTAMENTE ${dates.length} posts, uno por cada fecha en orden):
${dates.map((d, i) => `${i + 1}. ${d}`).join("\n")}

Devuelve el plan completo usando la tool submit_plan.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    system: PLAN_SYSTEM,
    tools: [tool],
    tool_choice: { type: "tool", name: "submit_plan" },
    messages: [{ role: "user", content: userPrompt }],
  });

  const toolUse = response.content.find((b: any) => b.type === "tool_use") as any;
  if (!toolUse || toolUse.name !== "submit_plan") {
    return NextResponse.json(
      { error: "Claude no devolvió plan válido", raw: response.content },
      { status: 500 }
    );
  }
  const plan: { posts: PlanPost[] } = toolUse.input;

  const created: any[] = [];
  let imagesOk = 0;
  let imagesFail = 0;

  for (const p of plan.posts) {
    let imagePath: string | undefined;
    if (generate_images && p.image_prompt) {
      try {
        const buf = await generateImage(p.image_prompt, openaiKey);
        if (buf) {
          imagePath = await uploadImage(buf);
          imagesOk++;
        } else {
          imagesFail++;
        }
      } catch {
        imagesFail++;
      }
    }
    const post = await createPost({
      text: p.text,
      visibility: "PUBLIC",
      scheduled_at: new Date(p.date_iso).toISOString(),
      image_path: imagePath,
    });
    created.push({ id: post.id, scheduled_at: post.scheduled_at, topic: p.topic, has_image: !!imagePath });
  }

  return NextResponse.json({
    posts_planned: plan.posts.length,
    posts_created: created.length,
    images_ok: imagesOk,
    images_failed: imagesFail,
    posts: created,
  });
}
