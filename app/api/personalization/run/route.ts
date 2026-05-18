import { NextResponse } from "next/server";
import { createJob, runJob, readCSVRows } from "@/lib/personalization";

export const runtime = "nodejs";
export const maxDuration = 600;
export const dynamic = "force-dynamic";

/**
 * POST /api/personalization/run
 * Body: { file_id, filename, mapping, prompt, provider, rows: [indices] }
 * Devuelve INMEDIATAMENTE con el job_id; la ejecución corre en background.
 * El cliente debe hacer polling a /jobs/[id] para ver el progreso.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { file_id, filename, mapping, prompt, provider, rows } = body;
  if (!file_id || !mapping || !prompt || !Array.isArray(rows)) {
    return NextResponse.json({ error: "Faltan campos requeridos" }, { status: 400 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ error: "Selecciona al menos 1 fila" }, { status: 400 });
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

  // Arrancar el job EN BACKGROUND (no esperamos a que termine).
  // Para CSVs grandes (1000+ leads) esto evita timeouts HTTP.
  // El cliente hace polling a /api/personalization/jobs/[id].
  runJob(job.id).catch((e) => {
    console.error(`[personalization] job ${job.id} fatal:`, e?.message || e);
  });

  return NextResponse.json({ ok: true, job });
}
