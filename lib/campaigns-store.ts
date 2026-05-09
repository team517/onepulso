import { readJson, writeJson } from "./storage";

const KEY = "campaigns";

export type CampaignRecord = {
  id: string;
  name: string;
  niche?: string;
  goal?: string;
  steps_count: number;
  variants_per_step: number[];
  leads_uploaded?: number;
  conversation_id?: string;
  created_at: string;
};

async function read(): Promise<CampaignRecord[]> {
  return (await readJson<CampaignRecord[]>(KEY)) ?? [];
}

async function write(records: CampaignRecord[]) {
  await writeJson(KEY, records);
}

export async function listCampaignRecords(): Promise<CampaignRecord[]> {
  const records = await read();
  return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function addCampaignRecord(rec: CampaignRecord) {
  const records = await read();
  records.push(rec);
  await write(records);
}

export async function updateCampaignRecord(id: string, patch: Partial<CampaignRecord>) {
  const records = await read();
  const idx = records.findIndex((r) => r.id === id);
  if (idx === -1) return;
  records[idx] = { ...records[idx], ...patch };
  await write(records);
}
