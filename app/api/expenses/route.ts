import { NextResponse } from "next/server";
import { listExpenses, createExpense, calcTotals } from "@/lib/expenses";

export const runtime = "nodejs";

export async function GET() {
  const items = await listExpenses();
  const totals = calcTotals(items);
  return NextResponse.json({ expenses: items, totals });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "name requerido" }, { status: 400 });
  }
  if (body.amount === undefined || body.amount === null || isNaN(Number(body.amount))) {
    return NextResponse.json({ error: "amount numérico requerido" }, { status: 400 });
  }
  const expense = await createExpense({
    name: body.name,
    amount: Number(body.amount),
    frequency: body.frequency,
    category: body.category,
    vendor: body.vendor,
    next_charge_date: body.next_charge_date,
    notes: body.notes,
    active: body.active,
  });
  return NextResponse.json({ expense });
}
