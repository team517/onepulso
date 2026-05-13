import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { tools, executeTool, SYSTEM_PROMPT } from "@/lib/anthropic-tools";
import { envVar } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 300;

type ChatMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "user" | "assistant"; content: any };

export async function POST(req: NextRequest) {
  const body = await req.json();
  const messages: ChatMessage[] = body.messages;
  const conversation_id: string | undefined = body.conversation_id;

  const apiKey = envVar("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "Falta ANTHROPIC_API_KEY en .env.local. Crea una key en console.anthropic.com y pégala ahí.",
      },
      { status: 500 }
    );
  }

  const client = new Anthropic({
    apiKey,
    maxRetries: 8, // SDK reintenta 8 veces 5xx/429/overloaded con backoff exponencial
    timeout: 180_000, // 3 min por llamada
  });

  const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const events: Array<{ type: string; data: any }> = [];

  /** Llama a Claude con retry adicional encima del SDK.
   *  Total: SDK (8 internal) × 3 outer = hasta 24 intentos antes de rendirse. */
  async function callClaudeWithRetry(): Promise<Anthropic.Messages.Message> {
    const maxOuterAttempts = 3;
    let lastErr: any;
    for (let attempt = 1; attempt <= maxOuterAttempts; attempt++) {
      try {
        return await client.messages.create({
          model: "claude-opus-4-7",
          max_tokens: 16000,
          system: SYSTEM_PROMPT,
          tools,
          messages: apiMessages,
        });
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? e?.statusCode;
        const msg = String(e?.message ?? e ?? "").toLowerCase();
        const retryable =
          status === 500 || status === 502 || status === 503 || status === 504 || status === 529 ||
          msg.includes("overloaded") || msg.includes("internal server") || msg.includes("temporarily");
        if (!retryable || attempt >= maxOuterAttempts) throw e;
        const wait = Math.min(3000 * 2 ** (attempt - 1), 15000); // 3s, 6s, 12s
        console.warn(`[chat] Claude error ${status} (${msg.slice(0, 80)}) — reintentando en ${wait}ms (${attempt}/${maxOuterAttempts})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  for (let i = 0; i < 20; i++) {
    let response: Anthropic.Messages.Message;
    try {
      response = await callClaudeWithRetry();
    } catch (e: any) {
      const status = e?.status ?? e?.statusCode;
      const friendly =
        status === 529 || /overloaded/i.test(String(e?.message))
          ? "Anthropic está saturado ahora mismo. Espera 30-60 segundos y vuelve a darle."
          : status >= 500
          ? "Anthropic tuvo un fallo interno (5xx). Reintenta en unos segundos — los servidores suelen recuperarse rápido."
          : status === 429
          ? "Has hecho demasiadas peticiones muy seguidas. Espera 30s."
          : e.message ?? String(e);
      events.push({
        type: "text",
        data: `\n\n⚠️ ${friendly}`,
      });
      break;
    }

    apiMessages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter((b) => b.type === "tool_use") as Array<
      Extract<Anthropic.Messages.ContentBlock, { type: "tool_use" }>
    >;

    for (const block of response.content) {
      if (block.type === "text" && block.text) {
        events.push({ type: "text", data: block.text });
      } else if (block.type === "tool_use") {
        events.push({
          type: "tool_use",
          data: { name: block.name, input: block.input },
        });
      }
    }

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      break;
    }

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const result = await executeTool(tu.name, tu.input, { conversation_id });
      events.push({
        type: "tool_result",
        data: { name: tu.name, output: result.slice(0, 600) },
      });
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: result,
      });
    }
    apiMessages.push({ role: "user", content: toolResults });
  }

  return NextResponse.json({ events });
}
