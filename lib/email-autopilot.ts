import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "./env";
import { memoryAsContext } from "./memory";
import {
  listThreads, scheduleFollowup, updateThread, updateFollowup,
  appendMessage, getThread, Thread,
} from "./email-threads";
import { sendEmail } from "./email-send";
import { readEmailConfig } from "./email-config";

const REPLY_SYSTEM = `Eres Xavi (onepulso). Estás escribiendo un email a un prospect en MODO AUTO-PILOT.

OBJETIVO POR DEFECTO: avanzar hacia una reunión / cierre.

DOS MODOS DE OPERACIÓN — el usuario te dirá cuál usar:

============== MODO A: RESPUESTA INMEDIATA ==============
(El prospect hizo pregunta o pidió info o puso objeción.)
- Lee TODO el hilo.
- Responde ESPECÍFICAMENTE a lo último que dijo.
- Si pide info → dásela + propón 10 min de call.
- Si pone objeción → trátala con un dato/caso.
- Si dice que no es momento → respeta + propón retomar más adelante.

============== MODO B: REMINDER PROGRAMADO ==============
(El prospect propuso una fecha futura para hacer algo. Tu mensaje SE ENVIARÁ ESE DÍA, no ahora.)
- Es un recordatorio amable que llega el día acordado, no una confirmación inmediata.
- Empieza haciendo referencia a lo que se acordó: "Hola X, como hablamos, te paso el [link / info / propuesta]..."
- Si pidió un link/material concreto, INCLÚYELO en el cuerpo.
- Cierra con CTA o pregunta concreta para mover la conversación.
- NO digas "ayer/la semana pasada hablamos" porque la IA no sabe la fecha exacta del envío. Usa "como hablamos".
- Tono: natural, como si lo escribieras tú esa mañana.

REGLAS COMUNES:
- Castellano España.
- Tono directo, personal, sin floritura. Sin emojis. Sin "estimado". (Si abajo se da TONO, prevalece.)
- Frases cortas. <p> entre bloques. <strong> en 1-2 puntos clave.
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

const CONTRACT_INTENT_SYSTEM = `Detectas si el prospect en este email está pidiendo CONTRATO, PROPUESTA, presupuesto firmable, PO, datos para facturar, o cualquier señal de "estoy listo para firmar/contratar".

Output JSON puro: { "is_contract_request": bool, "confidence": "high|medium|low", "excerpt": "frase exacta donde lo pide o null" }

Ejemplos que SÍ son petición:
- "Mándame el contrato"
- "Necesito una propuesta formal"
- "Pásame la oferta para firmar"
- "Dame los datos para hacer la transferencia / PO"
- "Vale, lo contratamos"
- "Pásame el SOW"

Ejemplos que NO:
- "Cuánto cuesta"
- "Quiero más info"
- "Tengo dudas sobre el precio"

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

async function aiDetectContractIntent(text: string, anthropicKey: string): Promise<{
  is_contract_request: boolean;
  confidence?: string;
  excerpt?: string | null;
}> {
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 2 });
  const r = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: CONTRACT_INTENT_SYSTEM,
    messages: [{ role: "user", content: `TEXTO:\n"""\n${text}\n"""` }],
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
    return { is_contract_request: false };
  }
}

async function aiGenerateReply(
  thread: Thread,
  anthropicKey: string,
  opts: { mode: "immediate" | "reminder"; deliveryDate?: string; dateContext?: string } = { mode: "immediate" },
): Promise<string> {
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 2, timeout: 120_000 });
  const memory = await memoryAsContext();
  const transcript = thread.messages
    .map((m) => {
      const who = m.direction === "outbound" ? "Xavi (yo)" : `Prospect (${m.from})`;
      const text = (m.body_text || stripHtml(m.body_html ?? "")).trim();
      return `--- ${who} | ${m.date}\n[Subject: ${m.subject}]\n${text}`;
    })
    .join("\n\n");

  const personalization: string[] = [];
  if (thread.contact_name?.trim()) {
    personalization.push(`Nombre del contacto: ${thread.contact_name.trim()}`);
  }
  if (thread.contact_context?.trim()) {
    personalization.push(`CONTEXTO ESPECÍFICO DE ESTE CONTACTO:\n"""\n${thread.contact_context.trim()}\n"""`);
  }
  if (thread.tone?.trim()) {
    personalization.push(`TONO REQUERIDO: ${thread.tone.trim()}`);
  }
  if (thread.objective?.trim()) {
    personalization.push(`OBJETIVO ESPECÍFICO: ${thread.objective.trim()}`);
  }
  if (thread.custom_prompt?.trim()) {
    personalization.push(`INSTRUCCIONES EXTRA:\n"""\n${thread.custom_prompt.trim()}\n"""`);
  }

  const personalizationBlock = personalization.length
    ? `\n${personalization.join("\n\n")}\n`
    : "";

  // Bloque de modo (immediate vs reminder)
  let modeBlock = "";
  if (opts.mode === "reminder") {
    const dateLabel = opts.deliveryDate
      ? new Date(opts.deliveryDate).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
      : "el día acordado";
    modeBlock = `\nMODO: B (REMINDER PROGRAMADO)\nFECHA DE ENVÍO: ${dateLabel} (este email se enviará ese día por la mañana, NO ahora).\n${opts.dateContext ? `Contexto temporal del prospect: "${opts.dateContext}"\n` : ""}\nEl email debe leerse como un recordatorio natural enviado ese día, no como respuesta inmediata.\n`;
  } else {
    modeBlock = `\nMODO: A (RESPUESTA INMEDIATA)\nEsta respuesta se envía ahora.\n`;
  }

  const r = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 2000,
    system: REPLY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `MEMORIA:\n${memory}\n${personalizationBlock}${modeBlock}\nHILO COMPLETO:\n${transcript}\n\nRedacta SOLO el body HTML del email.`,
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

// =====================================================
//  PLAN MULTI-FOLLOWUP — al activar el autopilot, IA
//  genera una secuencia de N mensajes escalonados.
// =====================================================

const SEQUENCE_SYSTEM = `Eres un experto en cold-outreach B2B. Vas a diseñar una SECUENCIA de follow-ups
que se enviarán automáticamente a un prospect, escalonados en el tiempo.

Devuelve JSON puro con este formato exacto:
{
  "steps": [
    {
      "day": 0,
      "intent": "primer recordatorio suave",
      "subject_hint": "opcional, sugerencia de subject (no para reenviar)",
      "body_html": "<p>...</p><p>Un saludo,<br>Xavi</p>"
    },
    ...
  ]
}

REGLAS DE LA SECUENCIA:
- Cada paso debe APORTAR ALGO NUEVO. No copies/parafrasees el anterior.
- Variar el ángulo: recordatorio → caso de éxito → dato/insight → pregunta abierta → "breakup".
- Castellano España. Tono según TONO indicado. Sin emojis salvo que se pida.
- Cada mensaje cierra con CTA alineado al OBJETIVO.
- Firma: <p>Un saludo,<br>Xavi</p>
- HTML simple: <p>, <strong>, <ul>/<li>. Sin tablas ni estilos.
- Frases cortas. Sin "estimado". Sin floritura.
- El último step puede ser un "breakup" (último intento, dejar la puerta abierta).

ESPACIADO TÍPICO (si el usuario no especifica intervalos):
- 3 steps: días 0, 4, 10
- 5 steps: días 0, 3, 7, 14, 21
- 7 steps: días 0, 2, 5, 9, 14, 21, 30

Devuelve SOLO el JSON, sin explicaciones, sin markdown.`;

export type SequenceStep = {
  day: number;
  intent: string;
  subject_hint?: string;
  body_html: string;
};

async function aiPlanSequence(
  thread: Thread,
  numSteps: number,
  strategy: string,
  anthropicKey: string,
): Promise<SequenceStep[]> {
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 2, timeout: 120_000 });
  const memory = await memoryAsContext();

  const transcript = thread.messages
    .map((m) => {
      const who = m.direction === "outbound" ? "Xavi (yo)" : `Prospect (${m.from})`;
      const text = (m.body_text || stripHtml(m.body_html ?? "")).trim();
      return `--- ${who} | ${m.date}\n[Subject: ${m.subject}]\n${text.slice(0, 600)}`;
    })
    .join("\n\n");

  const personalization: string[] = [];
  if (thread.contact_name?.trim()) personalization.push(`Nombre: ${thread.contact_name.trim()}`);
  if (thread.contact_context?.trim()) personalization.push(`CONTEXTO:\n${thread.contact_context.trim()}`);
  if (thread.tone?.trim()) personalization.push(`TONO: ${thread.tone.trim()}`);
  if (thread.objective?.trim()) personalization.push(`OBJETIVO: ${thread.objective.trim()}`);
  if (thread.custom_prompt?.trim()) personalization.push(`INSTRUCCIONES EXTRA:\n${thread.custom_prompt.trim()}`);

  const userMsg = `MEMORIA GLOBAL:\n${memory}\n\n${personalization.join("\n\n")}\n\nESTRATEGIA: ${strategy}\nNÚMERO DE STEPS: ${numSteps}\n\nHILO ACTUAL:\n${transcript || "(aún no se ha enviado nada)"}\n\nDiseña la secuencia de ${numSteps} follow-ups en JSON.`;

  const r = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4500,
    system: SEQUENCE_SYSTEM,
    messages: [{ role: "user", content: userMsg }],
  });

  const out = r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n")
    .trim();

  const clean = out.replace(/^```json\s*|\s*```$/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("La IA no devolvió JSON válido");

  const parsed = JSON.parse(clean.slice(start, end + 1));
  const steps: SequenceStep[] = parsed.steps ?? [];
  if (!Array.isArray(steps) || steps.length === 0) throw new Error("La IA no devolvió steps");

  return steps;
}

/**
 * Genera y programa una secuencia de N follow-ups para un thread.
 * - customDays: array de días opcional (ej. [0, 2, 5, 10, 21]). Si se pasa, sobrescribe los días del IA.
 * - sendFirstImmediately: si true, el primer step se envía AHORA (no se programa).
 */
export async function planAndScheduleSequence(
  threadId: string,
  numSteps: number = 5,
  strategy: string = "Equilibrada",
  options: {
    customDays?: number[];
    sendFirstImmediately?: boolean;
    defaultHour?: number;
  } = {},
): Promise<{ scheduled: number; sent_now: number; steps: SequenceStep[] }> {
  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY");

  const t = await getThread(threadId);
  if (!t) throw new Error("Thread no encontrado");

  const steps = await aiPlanSequence(t, numSteps, strategy, apiKey);

  // Si hay customDays, sobrescribir el día de cada step
  if (options.customDays && options.customDays.length > 0) {
    for (let i = 0; i < steps.length; i++) {
      if (i < options.customDays.length) {
        steps[i].day = options.customDays[i];
      }
    }
  }

  const defaultHour = options.defaultHour ?? 10;
  let scheduled = 0;
  let sent_now = 0;
  const now = new Date();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const isFirst = i === 0;

    // ENVIAR PRIMER STEP YA si sendFirstImmediately
    if (isFirst && options.sendFirstImmediately) {
      try {
        await sendNow(threadId, step.body_html);
        sent_now++;
        continue;
      } catch (e) {
        console.warn("[autopilot] sendNow falló, programando como fallback:", e);
        // si falla, lo programamos en 5 min
        const fallback = new Date(now.getTime() + 5 * 60 * 1000);
        await scheduleFollowup({
          thread_id: threadId,
          body_html: step.body_html,
          scheduled_at: fallback.toISOString(),
          origin: "ai_auto",
        });
        scheduled++;
        continue;
      }
    }

    // Programar normalmente
    const d = new Date(now);
    d.setDate(d.getDate() + (step.day ?? 0));
    if (step.day === 0 && d.getHours() >= defaultHour) {
      d.setTime(now.getTime() + 30 * 60 * 1000);
    } else {
      d.setHours(defaultHour, 0, 0, 0);
    }

    await scheduleFollowup({
      thread_id: threadId,
      body_html: step.body_html,
      scheduled_at: d.toISOString(),
      origin: "ai_auto",
    });
    scheduled++;
  }

  return { scheduled, sent_now, steps };
}

/**
 * Envía un email inmediatamente como respuesta al hilo.
 * Reutiliza la lógica del scheduler.
 */
async function sendNow(threadId: string, bodyHtml: string): Promise<void> {
  const cfg = await readEmailConfig();
  if (!cfg) throw new Error("Email no conectado");
  const thread = await getThread(threadId);
  if (!thread) throw new Error("Thread no encontrado");

  // Reply al ÚLTIMO mensaje del hilo (cualquier dirección)
  const lastMsg = thread.messages[thread.messages.length - 1];
  const refMsg = lastMsg;

  const recipient =
    thread.participants.find((p) => p.toLowerCase() !== cfg.email.toLowerCase()) ??
    thread.participants[0];

  const baseSubject = thread.subject.replace(/^(re:\s*)+/i, "").trim();
  const subject = `Re: ${baseSubject}`;

  // Cadena de References completa
  const refsChain: string[] = [];
  if (refMsg?.references) refsChain.push(...refMsg.references);
  if (refMsg?.in_reply_to && !refsChain.includes(refMsg.in_reply_to)) {
    refsChain.push(refMsg.in_reply_to);
  }
  if (refMsg?.message_id && !refsChain.includes(refMsg.message_id)) {
    refsChain.push(refMsg.message_id);
  }

  const info = await sendEmail({
    to: recipient,
    subject,
    body_html: bodyHtml,
    in_reply_to: refMsg?.message_id,
    references: refsChain.length > 0 ? refsChain : undefined,
  });

  await appendMessage(threadId, {
    direction: "outbound",
    from: cfg.email,
    to: [recipient],
    subject,
    body_html: bodyHtml,
    message_id: info.messageId,
    in_reply_to: refMsg?.message_id,
    references: refsChain.length > 0 ? refsChain : undefined,
    date: new Date().toISOString(),
  });
}

/**
 * Procesa todos los threads en auto_pilot que tengan inbound nuevo no procesado.
 * Para cada uno: extrae fecha del último inbound, redacta respuesta y la programa.
 * También detecta si hay petición de contrato y marca el thread.
 */
export async function runAutopilot(): Promise<{ processed: number; scheduled: number; contract_alerts: number; errors: number }> {
  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) return { processed: 0, scheduled: 0, contract_alerts: 0, errors: 0 };

  const threads = await listThreads();
  let processed = 0;
  let scheduled = 0;
  let contract_alerts = 0;
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

    // Esperar 3 minutos antes de procesar (deja tiempo al humano de leer/intervenir)
    const ageMs = Date.now() - new Date(lastInbound.date).getTime();
    if (ageMs < 3 * 60 * 1000) {
      console.log(`[autopilot] thread ${t.id} inbound demasiado reciente (${Math.round(ageMs/1000)}s) — esperando 3 min`);
      continue;
    }

    // Si hay follow-ups programados y el prospect ha respondido,
    // CANCELAMOS los pendientes (la conversación cambió de rumbo)
    // y generamos una respuesta contextual nueva con date-aware scheduling.
    const pendingFus = t.followups.filter((f) => f.status === "scheduled");
    if (pendingFus.length > 0) {
      for (const f of pendingFus) {
        await updateFollowup(t.id, f.id, { status: "cancelled" });
      }
      console.log(`[autopilot] cancelados ${pendingFus.length} follow-ups (prospect respondió)`);
    }

    try {
      processed++;
      const inboundText = (lastInbound.body_text || stripHtml(lastInbound.body_html ?? "")).trim();

      // 0) Detectar petición de contrato (asíncrono junto a fecha)
      const [dateInfo, contractInfo] = await Promise.all([
        aiExtractDate(inboundText, apiKey),
        aiDetectContractIntent(inboundText, apiKey),
      ]);

      // 1) Si pide contrato → marcar alerta y NO programar respuesta automática (humano debe revisar)
      if (contractInfo.is_contract_request && (contractInfo.confidence === "high" || contractInfo.confidence === "medium")) {
        await updateThread(t.id, {
          contract_alert: {
            detected_at: new Date().toISOString(),
            message_id: lastInbound.message_id,
            excerpt: contractInfo.excerpt || inboundText.slice(0, 200),
            acknowledged: false,
          },
        });
        contract_alerts++;
        // Marcar como procesado para que no vuelva a entrar
        const ids = [...(t.auto_pilot_processed_msg_ids ?? [])];
        if (lastInbound.message_id) ids.push(lastInbound.message_id);
        await updateThread(t.id, { auto_pilot_processed_msg_ids: ids });
        continue;
      }

      // 2) Decidir flujo según si hay fecha futura
      const hasFutureDate = dateInfo.has_date && dateInfo.date_iso &&
                            new Date(dateInfo.date_iso).getTime() > Date.now() + 30 * 60 * 1000;

      // SIEMPRE generar la respuesta INMEDIATA de confirmación
      const immediateAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      const immediateReply = await aiGenerateReply(t, apiKey, {
        mode: "immediate",
        dateContext: dateInfo.date_text || undefined,
      });
      await scheduleFollowup({
        thread_id: t.id,
        body_html: immediateReply,
        scheduled_at: immediateAt,
        origin: "ai_auto",
        status: "pending_approval",
      });
      scheduled++;

      // SI hay fecha futura → ADEMÁS programar un REMINDER para ese día
      if (hasFutureDate) {
        const target = new Date(dateInfo.date_iso!);
        const explicitTime = /\b\d{1,2}:\d{2}\b/.test(dateInfo.date_text || "");

        if (explicitTime) {
          // Hora explícita → enviar 1h antes
          target.setTime(target.getTime() - 60 * 60 * 1000);
        } else {
          // Sin hora explícita → 9:00 del día
          target.setHours(9, 0, 0, 0);
        }
        if (target.getTime() <= Date.now() + 60 * 60 * 1000) {
          target.setTime(Date.now() + 24 * 60 * 60 * 1000); // mín. mañana
        }

        const reminderAt = target.toISOString();
        const reminderBody = await aiGenerateReply(t, apiKey, {
          mode: "reminder",
          deliveryDate: reminderAt,
          dateContext: dateInfo.date_text || undefined,
        });
        await scheduleFollowup({
          thread_id: t.id,
          body_html: reminderBody,
          scheduled_at: reminderAt,
          origin: "ai_auto",
          status: "pending_approval",
        });
        scheduled++;
      }

      const ids = [...(t.auto_pilot_processed_msg_ids ?? [])];
      if (lastInbound.message_id) ids.push(lastInbound.message_id);
      await updateThread(t.id, { auto_pilot_processed_msg_ids: ids });
    } catch (e: any) {
      console.error(`[autopilot] thread ${t.id} error:`, e.message);
      errors++;
    }
  }

  return { processed, scheduled, contract_alerts, errors };
}
