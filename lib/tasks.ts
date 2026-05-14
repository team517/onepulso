import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "tasks";

export type TaskPriority = "low" | "medium" | "high";
export type TaskStatus = "pending" | "done";

export type Task = {
  id: string;
  title: string;
  description?: string;
  due_at?: string;          // ISO date — opcional
  status: TaskStatus;
  priority: TaskPriority;   // low | medium | high
  /** Si la tarea está vinculada a un cliente concreto */
  client_thread_id?: string;
  client_email?: string;
  client_name?: string;
  created_at: string;
  completed_at?: string;
  /** Para no enviar el recordatorio dos veces */
  reminder_sent_at?: string;
};

export async function listTasks(): Promise<Task[]> {
  return (await readJson<Task[]>(KEY)) ?? [];
}

async function saveTasks(tasks: Task[]) {
  await writeJson(KEY, tasks);
}

export async function createTask(input: Omit<Partial<Task>, "id" | "created_at" | "status"> & { title: string }): Promise<Task> {
  const tasks = await listTasks();
  const task: Task = {
    id: randomUUID(),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    due_at: input.due_at || undefined,
    status: "pending",
    priority: input.priority ?? "medium",
    client_thread_id: input.client_thread_id || undefined,
    client_email: input.client_email || undefined,
    client_name: input.client_name || undefined,
    created_at: new Date().toISOString(),
  };
  tasks.push(task);
  await saveTasks(tasks);
  return task;
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
  const tasks = await listTasks();
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...patch };
  // Si pasa a done por primera vez, set completed_at
  if (patch.status === "done" && !tasks[idx].completed_at) {
    tasks[idx].completed_at = new Date().toISOString();
  }
  if (patch.status === "pending") {
    tasks[idx].completed_at = undefined;
  }
  await saveTasks(tasks);
  return tasks[idx];
}

export async function deleteTask(id: string): Promise<void> {
  const tasks = await listTasks();
  const next = tasks.filter((t) => t.id !== id);
  await saveTasks(next);
}

/** Marca el recordatorio como enviado para no duplicarlo */
export async function markReminderSent(id: string): Promise<void> {
  await updateTask(id, { reminder_sent_at: new Date().toISOString() });
}
