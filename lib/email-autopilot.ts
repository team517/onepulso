import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "./env";
import { memoryAsContext } from "./memory";
import { listThreads, scheduleFollowup, updateThread, Thread } from "./email-threads";

const REPLY_SYSTEM = `Eres Xavi (onepulso). Estás respondiendo a un hilo de email real con un prospect en MODO AUTO-PILOT.

OBJETIVO: avanzar el hilo hacia una reunión / cierre, manteniendo tono natural.

REGLAS:
- Castellano España.
- Tono directo, personal, sin floritura. Sin emojis. Sin "estimado".
- Lee TODO el hilo. Responde ESPECÍFICAMENTE a lo último que dijo el prospect.
- Si propone fecha ("el jueves", "la semana que viene", "después de vacaciones") → reconócela y propón concretarla con día y hora.
- Si pide info → dásela + propón 10 min de call.
- Si pone objeción → trátala con un dato/caso.
- Si dice que no es momento → respeta + propón retomar más adelante.
- Frases cortas, <p> entre bloques, <strong> en 1-2 puntos clave.
- Cierra con CTA claro.
- Firma: <p>Un saludo,<br>Xavi</p>

OUTPUT: solo el body HTML, sin meta-comentarios.`;

const DATE_SYSTEM = `Extraes intención temporal de un email recibido.

Output JSON puro: { "has_date": bool, "date_iso": "YYYY-MM-DDTHH:mm" o null, "confidence": "high|medium|low", "reasoning": "string", "date_text": "string" }

Reglas:
- "today_iso" es la fecha actual.
- "jueves que viene" → próximo jueves 10:00.
- "la semana que viene" / "next week" → lunes próximo 10:00.
- "a final de semana" / "finales de la semana que viene" → viernes próximo 10:00.
- "después de vacaciones" → +14 días, low confidence.
- "después del verano" → 1 sept 10:00 si es entre jun-ago.
- "en X días" → +X días.
- "en X semanas" → +X*7 días.
- Sin nada temporal claro → has_date: false.
- Si propone hora ("a las 16h") → respétala.

Si el prospect dice "te confirmo a finales de la semana que viene" → has_date: true, date_iso = viernes próximo 17:00, confidence: medium.
Si dice "ahora estoy a tope, escríbeme la semana que viene" → has_date: true, date_iso = lunes próximo 10:00.

JSON puro, sin markdown.`;

async function aiExtractDate(text: string, anthropicKey: string): Promise<{
  has_date: boolean;
  date_iso?: string | null;
  confidence?: string;
  reasoning?: string;
  date_text?: string;
}> {
  const today = new Date();
  const dow = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][today.getDay()];
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 2 });
  const r = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    system: DATE_SYSTEM,
    messages: [
      {
        role: "user",
        content: `today_iso: ${today.toISOString()}\nday_of_week: ${dow}\n\nTEXTO:\n"""\n${text}\n"""`,
      },
    ],
  });
  const out = r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
  const clean = out.replace(/^```json\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    return { has_date: false };
  }
}

async function aiGenerateReply(thread: Thread, anthropicKey: string): Promise<string> {
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 2, timeout: 120_000 });
  const memory = await memoryAsContext();
  const transcript = thread.messages
    .map((m) => {
      const who = m.direction === "outbound" ? "Xavi (yo)" : `Prospect (${m.from})`;
      const text = (m.body_text || stripHtml(m.body_html ?? "")).trim();
      return `--- ${who} | ${m.date}\n[Subject: ${m.subject}]\n${text}`;
    })
    .join("\n\n");

  const r = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2000,
    system: REPLY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `MEMORIA:\n${memory}\n\nHILO COMPLETO:\n${transcript}\n\nRedacta SOLO el body HTML de la siguiente respuesta de Xavi.`,
      },
    ],
  });
  return r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

function stripHtml(s: string): string {
  return s.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Procesa todos los threads en auto_pilot que tengan inbound nuevo no procesado.
 * Para cada uno: extrae fecha del último inbound, redacta respuesta y la programa.
 */
export async function runAutopilot(): Promise<{ processed: number; scheduled: number; errors: number }> {
  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) return { processed: 0, scheduled: 0, errors: 0 };

  const threads = await listThreads();
  let processed = 0;
  let scheduled = 0;
  let errors = 0;

  for (const t of threads) {
    if (!t.auto_pilot) continue;
    if (t.status === "closed") continue;

    // Encuentra último inbound no procesado
    const processedIds = new Set(t.auto_pilot_processed_msg_ids ?? []);
    const lastInbound = [...t.messages].reverse().find(
      (m) => m.direction === "inbound" && (!m.message_id || !processedIds.has(m.message_id))
    );
    if (!lastInbound) continue;

    // Solo procesar si el último mensaje del thread es ese inbound (el prospect respondió,
    // y no le hemos escrito todavía)
    const last = t.messages[t.messages.length - 1];
    if (last.id !== lastInbound.id) continue;

    // Si ya hay un followup programado para este thread, no duplicar
    const hasPendingFu = t.followups.some((f) => f.status === "scheduled");
    if (hasPendingFu) {
      // Marcar como procesado para no re-evaluar
      const ids = [...(t.auto_pilot_processed_msg_ids ?? [])];
      if (lastInbound.message_id) ids.push(lastInbound.message_id);
      await updateThread(t.id, { auto_pilot_processed_msg_ids: ids });
      continue;
    }

    try {
      processed++;
      const inboundText = (lastInbound.body_text || stripHtml(lastInbound.body_html ?? "")).trim();

      // 1) Extraer fecha
      const dateInfo = await aiExtractDate(inboundText, apiKey);

      // 2) Generar reply
      const reply = await aiGenerateReply(t, apiKey);

      // 3) Decidir cuándo programar
      let scheduledAt: string;
      if (dateInfo.has_date && dateInfo.date_iso) {
        scheduledAt = new Date(dateInfo.date_iso).toISOString();
      } else {
        // Por defecto: respondemos en 30 minutos (suficiente para que parezca natural)
        scheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      }

      await scheduleFollowup({
        thread_id: t.id,
        body_html: reply,
        scheduled_at: scheduledAt,
        origin: "ai_auto",
      });
      scheduled++;

      // Marcar inbound como procesado
      const ids = [...(t.auto_pilot_processed_msg_ids ?? [])];
      if (lastInbound.message_id) ids.push(lastInbound.message_id);
      await updateThread(t.id, { auto_pilot_processed_msg_ids: ids });
    } catch (e: any) {
      console.error(`[autopilot] thread ${t.id} error:`, e.message);
      errors++;
    }
  }

  return { processed, scheduled, errors };
}
