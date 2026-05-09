import { promises as fs } from "fs";
import path from "path";
import { dataPath } from "./data-dir";

const FILE = dataPath("campaigns.json");

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
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function write(records: CampaignRecord[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(records, null, 2), "utf-8");
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
