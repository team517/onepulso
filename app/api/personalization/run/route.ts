import { NextResponse } from "next/server";
import { createJob, runJob, readCSVRows } from "@/lib/personalization";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 min para procesar lotes
export const dynamic = "force-dynamic";

/**
 * POST /api/personalization/run
 * Body: { file_id, filename, mapping, prompt, provider, rows: [indices] }
 * Crea un job y lo ejecuta INMEDIATAMENTE. Devuelve cuando termina.
 * Para volúmenes muy altos, mejor abrir como background (versión next).
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { file_id, filename, mapping, prompt, provider, rows } = body;
  if (!file_id || !mapping || !prompt || !Array.isArray(rows)) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }

  // Saber total_rows
  let total = 0;
  try {
    const r = await readCSVRows(file_id);
    total = r.rows.length;
  } catch (e: any) {
    return NextResponse.json({ error: `No pude leer CSV: ${e.message}` }, { status: 400 });
  }

  const job = await createJob({
    file_id,
    filename: filename || "(sin nombre)",
    total_rows: total,
    selected_rows: rows,
    mapping,
    prompt,
    provider: provider || "claude",
  });

  try {
    const final = await runJob(job.id);
    return NextResponse.json({ ok: true, job: final });
  } catch (e: any) {
    return NextResponse.json({ ok: false, job_id: job.id, error: e.message }, { status: 500 });
  }
}
