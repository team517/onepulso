import { NextResponse } from "next/server";
import { listClientsWithConfig } from "@/lib/client-reports";

export const runtime = "nodejs";
export const maxDuration = 60;

/** GET → clientes de Smartlead + su config de informe. */
export async function GET() {
  try {
    const clients = await listClientsWithConfig();
    return NextResponse.json({ clients });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e), clients: [] }, { status: 200 });
  }
}
