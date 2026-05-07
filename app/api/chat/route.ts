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
    maxRetries: 4, // reintenta 5xx / overloaded
    timeout: 180_000, // 3 min por llamada (campañas con 12 variantes pueden ser largas)
  });

  const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const events: Array<{ type: string; data: any }> = [];

  for (let i = 0; i < 20; i++) {
    let response: Anthropic.Messages.Message;
    try {
      response = await client.messages.create({
        model: "claude-opus-4-7",
        max_tokens: 16000, // suficiente para 12 variantes con HTML
        system: SYSTEM_PROMPT,
        tools,
        messages: apiMessages,
      });
    } catch (e: any) {
      events.push({
        type: "text",
        data: `\n\n⚠️ Error llamando a Claude: ${e.message ?? String(e)}. Iteración ${i + 1}/20. Reintenta el mensaje si quieres.`,
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
