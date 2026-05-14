import { NextResponse } from "next/server";
import { listTasks, createTask } from "@/lib/tasks";

export const runtime = "nodejs";

export async function GET() {
  const tasks = await listTasks();
  return NextResponse.json({ tasks });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.title || typeof body.title !== "string") {
    return NextResponse.json({ error: "title requerido" }, { status: 400 });
  }
  const task = await createTask({
    title: body.title,
    description: body.description,
    due_at: body.due_at,
    priority: body.priority,
    client_thread_id: body.client_thread_id,
    client_email: body.client_email,
    client_name: body.client_name,
  });
  return NextResponse.json({ task });
}
