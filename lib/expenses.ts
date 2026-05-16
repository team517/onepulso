import { randomUUID } from "crypto";
import { readJson, writeJson } from "./storage";

const KEY = "expenses";

export type ExpenseFrequency = "monthly" | "yearly" | "quarterly" | "weekly" | "one-time";

export type Expense = {
  id: string;
  name: string;
  amount: number;             // EUR, número, puede tener decimales
  frequency: ExpenseFrequency;
  category?: string;          // "Software", "Oficina", "Marketing", etc.
  vendor?: string;            // Quién cobra (ej: "OpenAI", "Railway")
  next_charge_date?: string;  // ISO date, opcional
  notes?: string;
  active: boolean;            // false = ya no se paga
  created_at: string;
  updated_at: string;
};

export async function listExpenses(): Promise<Expense[]> {
  return (await readJson<Expense[]>(KEY)) ?? [];
}

async function saveAll(items: Expense[]) {
  await writeJson(KEY, items);
}

export async function createExpense(input: Partial<Expense> & { name: string; amount: number }): Promise<Expense> {
  const items = await listExpenses();
  const now = new Date().toISOString();
  const expense: Expense = {
    id: randomUUID(),
    name: input.name.trim(),
    amount: Number(input.amount) || 0,
    frequency: input.frequency || "monthly",
    category: input.category?.trim() || undefined,
    vendor: input.vendor?.trim() || undefined,
    next_charge_date: input.next_charge_date || undefined,
    notes: input.notes?.trim() || undefined,
    active: input.active !== false,
    created_at: now,
    updated_at: now,
  };
  items.push(expense);
  await saveAll(items);
  return expense;
}

export async function updateExpense(id: string, patch: Partial<Expense>): Promise<Expense | null> {
  const items = await listExpenses();
  const idx = items.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  items[idx] = {
    ...items[idx],
    ...patch,
    id: items[idx].id,
    created_at: items[idx].created_at,
    updated_at: new Date().toISOString(),
  };
  await saveAll(items);
  return items[idx];
}

export async function deleteExpense(id: string): Promise<void> {
  const items = await listExpenses();
  await saveAll(items.filter((e) => e.id !== id));
}

/** Calcula el coste mensual equivalente de un gasto según su frecuencia. */
export function monthlyEquivalent(e: Expense): number {
  if (!e.active) return 0;
  switch (e.frequency) {
    case "monthly":   return e.amount;
    case "yearly":    return e.amount / 12;
    case "quarterly": return e.amount / 3;
    case "weekly":    return e.amount * 52 / 12;
    case "one-time":  return 0; // no recurrente, no cuenta para mensual
    default:          return 0;
  }
}

/** Totales por mes y por año a partir de la lista. */
export function calcTotals(items: Expense[]): { monthly: number; yearly: number; by_category: Record<string, number> } {
  let monthly = 0;
  const byCategory: Record<string, number> = {};
  for (const e of items) {
    const m = monthlyEquivalent(e);
    monthly += m;
    const cat = e.category || "Sin categoría";
    byCategory[cat] = (byCategory[cat] ?? 0) + m;
  }
  return {
    monthly: round2(monthly),
    yearly: round2(monthly * 12),
    by_category: Object.fromEntries(
      Object.entries(byCategory).map(([k, v]) => [k, round2(v)])
    ),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
