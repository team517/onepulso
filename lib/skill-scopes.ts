import { promises as fs } from "fs";
import path from "path";

const FILE = path.join(process.cwd(), "data", "skill-scopes.json");

export type Scope = "campaigns" | "linkedin";

type ScopesMap = Record<string, Scope[]>;

async function read(): Promise<ScopesMap> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf-8"));
  } catch {
    return {};
  }
}

async function write(map: ScopesMap) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(map, null, 2), "utf-8");
}

export async function getScopes(skillName: string): Promise<Scope[]> {
  const m = await read();
  return m[skillName] ?? [];
}

export async function setScopes(skillName: string, scopes: Scope[]) {
  const m = await read();
  m[skillName] = Array.from(new Set(scopes));
  await write(m);
}

export async function addToScope(skillName: string, scope: Scope) {
  const m = await read();
  const cur = new Set(m[skillName] ?? []);
  cur.add(scope);
  m[skillName] = [...cur];
  await write(m);
}

export async function removeFromScope(skillName: string, scope: Scope) {
  const m = await read();
  const cur = (m[skillName] ?? []).filter((s) => s !== scope);
  if (cur.length === 0) delete m[skillName];
  else m[skillName] = cur;
  await write(m);
}

export async function listSkillsInScope(scope: Scope): Promise<string[]> {
  const m = await read();
  return Object.entries(m)
    .filter(([, s]) => s.includes(scope))
    .map(([name]) => name);
}

export async function allMappings(): Promise<ScopesMap> {
  return read();
}
