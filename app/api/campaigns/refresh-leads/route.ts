import { NextResponse } from "next/server";
import { listCampaignRecords, updateCampaignRecord } from "@/lib/campaigns-store";
import { countLeadsInCampaign, listCampaigns } from "@/lib/instantly";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/campaigns/refresh-leads
 * Recorre todas las campañas locales (y las que devuelve Instantly) y
 * actualiza el contador `leads_uploaded` con el valor REAL de Instantly.
 * Útil cuando subiste leads desde fuera de la plataforma y aquí marcaba menos.
 */
export async function POST() {
  const localRecords = await listCampaignRecords();
  // También miramos las campañas de Instantly por si hay alguna sin record local
  let instantlyCampaigns: any[] = [];
  try {
    const r = await listCampaigns(100);
    instantlyCampaigns = Array.isArray(r?.items) ? r.items : Array.isArray(r) ? r : [];
  } catch {}

  const allIds = new Set<string>();
  for (const r of localRecords) if (r.id) allIds.add(r.id);
  for (const c of instantlyCampaigns) if (c.id) allIds.add(c.id);

  const results: Array<{ id: string; name?: string; leads: number | null; status: "ok" | "skip" | "err" }> = [];
  let updated = 0;

  for (const id of allIds) {
    try {
      const count = await countLeadsInCampaign(id);
      if (count === null) {
        results.push({ id, leads: null, status: "skip" });
        continue;
      }
      // Actualizar el record local (si existe), si no, ignorar (no tenemos record local)
      const localRec = localRecords.find((r) => r.id === id);
      if (localRec) {
        await updateCampaignRecord(id, { leads_uploaded: count });
        results.push({ id, name: localRec.name, leads: count, status: "ok" });
        updated++;
      } else {
        const instRec = instantlyCampaigns.find((c) => c.id === id);
        results.push({ id, name: instRec?.name, leads: count, status: "ok" });
      }
    } catch (e: any) {
      results.push({ id, leads: null, status: "err" });
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    total_campaigns_checked: results.length,
    results,
  });
}
