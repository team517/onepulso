import { NextResponse } from "next/server";
import { startScheduler, tick } from "@/lib/scheduler";

export const runtime = "nodejs";
export const maxDuration = 120;

// El scheduler se inicia la primera vez que se golpea cualquier endpoint del módulo
startScheduler();

export async function POST() {
  const result = await tick();
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({ scheduler: "running", tick_interval_ms: 30000 });
}
