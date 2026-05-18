import { NextResponse } from "next/server";
import { listJobs } from "@/lib/personalization";

export const runtime = "nodejs";

export async function GET() {
  const jobs = await listJobs();
  // Sin results completos en el listado (sería pesado)
  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      filename: j.filename,
      provider: j.provider,
      status: j.status,
      progress: j.progress,
      total_rows: j.total_rows,
      selected_count: j.selected_rows.length,
      created_at: j.created_at,
      updated_at: j.updated_at,
    })),
  });
}
