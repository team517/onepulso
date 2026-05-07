import { promises as fs, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "credentials.json");

const KNOWN_KEYS = [
  "ANTHROPIC_API_KEY",
  "INSTANTLY_API_KEY",
  "OPENAI_API_KEY",
  "LINKEDIN_CLIENT_ID",
  "LINKEDIN_CLIENT_SECRET",
] as const;

export type CredentialKey = (typeof KNOWN_KEYS)[number];

type CredentialMap = Partial<Record<CredentialKey, string>>;

export function readCredentialsSync(): CredentialMap {
  try {
    if (!existsSync(FILE)) return {};
    return JSON.parse(readFileSync(FILE, "utf-8"));
  } catch {
    return {};
  }
}

export async function readCredentials(): Promise<CredentialMap> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeCredentials(creds: CredentialMap) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(creds, null, 2), "utf-8");
}

export async function setCredential(key: CredentialKey, value: string) {
  const cur = await readCredentials();
  if (value && value.trim()) cur[key] = value.trim();
  else delete cur[key];
  await writeCredentials(cur);
}

export async function clearCredential(key: CredentialKey) {
  const cur = await readCredentials();
  delete cur[key];
  await writeCredentials(cur);
}

export function mask(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(value.length);
  return value.slice(0, 6) + "•".repeat(Math.max(value.length - 10, 4)) + value.slice(-4);
}

export function isKnown(k: string): k is CredentialKey {
  return (KNOWN_KEYS as readonly string[]).includes(k);
}
