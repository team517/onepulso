import { readJson, writeJson } from "./storage";

const KEY = "skill-scopes";

export type Scope = "campaigns" | "linkedin";

type ScopesMap = Record<string, Scope[]>;

async function read(): Promise<ScopesMap> {
  return (await readJson<ScopesMap>(KEY)) ?? {};
}

async function write(map: ScopesMap) {
  await writeJson(KEY, map);
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
