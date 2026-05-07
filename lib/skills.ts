import { promises as fs } from "fs";
import path from "path";
import { listSkillsInScope, Scope } from "./skill-scopes";

const SKILLS_ROOT = path.resolve(process.cwd(), "..", ".agents", "skills");

export type SkillSummary = {
  name: string;
  description: string;
  source?: string;
};

export type SkillFull = SkillSummary & {
  content: string;
  raw: string;
};

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  // Normalize line endings so Windows files parse correctly
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return { meta: {}, body: normalized };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { meta: {}, body: normalized };
  const fmRaw = normalized.slice(3, end).trim();
  const body = normalized.slice(end + 4).trimStart();
  const meta: Record<string, string> = {};
  for (const line of fmRaw.split("\n")) {
    // Skip nested-yaml continuation lines (start with whitespace)
    if (/^\s/.test(line)) continue;
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body };
}

export async function listSkills(scope?: Scope): Promise<SkillSummary[]> {
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(SKILLS_ROOT);
  } catch {
    return [];
  }
  const allowed = scope ? new Set(await listSkillsInScope(scope)) : null;
  const out: SkillSummary[] = [];
  for (const d of dirs) {
    if (allowed && !allowed.has(d)) continue;
    const skillFile = path.join(SKILLS_ROOT, d, "SKILL.md");
    try {
      const raw = await fs.readFile(skillFile, "utf-8");
      const { meta } = parseFrontmatter(raw);
      out.push({
        name: meta.name ?? d,
        description: meta.description ?? "(sin descripción)",
      });
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSkill(name: string): Promise<SkillFull | null> {
  let dirs: string[];
  try {
    dirs = await fs.readdir(SKILLS_ROOT);
  } catch {
    return null;
  }
  // first try exact dir match
  let dir = dirs.find((d) => d === name);
  if (!dir) {
    // try meta name match
    for (const d of dirs) {
      const skillFile = path.join(SKILLS_ROOT, d, "SKILL.md");
      try {
        const raw = await fs.readFile(skillFile, "utf-8");
        const { meta } = parseFrontmatter(raw);
        if (meta.name === name) {
          dir = d;
          break;
        }
      } catch {
        /* skip */
      }
    }
  }
  if (!dir) return null;
  const skillFile = path.join(SKILLS_ROOT, dir, "SKILL.md");
  try {
    const raw = await fs.readFile(skillFile, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    return {
      name: meta.name ?? dir,
      description: meta.description ?? "(sin descripción)",
      content: body,
      raw,
    };
  } catch {
    return null;
  }
}

export async function skillsCatalogForPrompt(): Promise<string> {
  const all = await listSkills();
  if (all.length === 0) return "(no skills installed)";
  return all.map((s) => `- ${s.name}: ${s.description}`).join("\n");
}
