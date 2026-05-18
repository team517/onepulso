/**
 * Capa de abstracción para llamar a distintos LLMs.
 * Por ahora: Claude (Anthropic) y DeepSeek (OpenAI-compatible).
 * Permite cambiar de proveedor sin tocar el resto del código.
 */
import Anthropic from "@anthropic-ai/sdk";
import { envVar } from "./env";
import { readJson, writeJson } from "./storage";

const SETTINGS_KEY = "ai-personalization-settings";

export type AIProvider = "claude" | "deepseek";

export type AIPersonalizationSettings = {
  default_provider: AIProvider;
  deepseek_api_key?: string;
  deepseek_model?: string;        // ej: "deepseek-chat" o "deepseek-reasoner"
  claude_model?: string;          // ej: "claude-haiku-4-5-20251001"
};

export async function getSettings(): Promise<AIPersonalizationSettings> {
  return (
    (await readJson<AIPersonalizationSettings>(SETTINGS_KEY)) ?? {
      default_provider: "claude",
      claude_model: "claude-haiku-4-5-20251001",
      deepseek_model: "deepseek-chat",
    }
  );
}

export async function saveSettings(patch: Partial<AIPersonalizationSettings>): Promise<AIPersonalizationSettings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  // Si pasan deepseek_api_key vacía, quitarla
  if (patch.deepseek_api_key === "") delete next.deepseek_api_key;
  await writeJson(SETTINGS_KEY, next);
  return next;
}

export type GenerateOptions = {
  provider?: AIProvider;
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
};

export async function generateText(opts: GenerateOptions): Promise<string> {
  const settings = await getSettings();
  const provider = opts.provider || settings.default_provider;

  if (provider === "deepseek") {
    return await callDeepSeek(opts, settings);
  }
  return await callClaude(opts, settings);
}

async function callClaude(opts: GenerateOptions, settings: AIPersonalizationSettings): Promise<string> {
  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en variables de entorno.");
  const client = new Anthropic({ apiKey, maxRetries: 6, timeout: 120_000 });
  const r = await client.messages.create({
    model: settings.claude_model || "claude-haiku-4-5-20251001",
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.7,
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.prompt }],
  });
  return r.content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();
}

async function callDeepSeek(opts: GenerateOptions, settings: AIPersonalizationSettings): Promise<string> {
  const apiKey = settings.deepseek_api_key || envVar("DEEPSEEK_API_KEY");
  if (!apiKey) throw new Error("Falta API Key de DeepSeek. Configúrala en Personalización → Ajustes.");
  const messages: any[] = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.prompt });
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.deepseek_model || "deepseek-chat",
      messages,
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.7,
      stream: false,
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`DeepSeek API ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data: any = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error("DeepSeek devolvió respuesta vacía");
  return String(content).trim();
}

/** Test rápido de credenciales para mostrar si están bien en settings. */
export async function testProvider(provider: AIProvider): Promise<{ ok: boolean; error?: string; sample?: string }> {
  try {
    const sample = await generateText({
      provider,
      prompt: "Responde solo con 'OK' (sin comillas, sin nada más).",
      maxTokens: 10,
    });
    return { ok: true, sample };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}
