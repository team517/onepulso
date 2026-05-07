import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

const SKILLS_ROOT = path.resolve(process.cwd(), "..", ".agents", "skills");

export type InstalledSkill = { name: string; path: string };

/**
 * Acepta:
 *   - "owner/repo@skill" / "owner/repo"
 *   - URLs de skills.sh / github.com
 *   - El comando completo: "npx skills add <repo-or-url> [--skill name | -s name]"
 */
export function parseIdentifier(input: string): { cliArg: string; preferredSkillName?: string } {
  let trimmed = input.trim();

  // Si pegan el comando entero, extraer la parte relevante
  if (/^npx\s+/i.test(trimmed)) {
    // tokens del comando
    const tokens = trimmed.split(/\s+/);
    // buscar arg después de "add"
    const addIdx = tokens.findIndex((t) => t.toLowerCase() === "add");
    let target: string | undefined;
    let skillFlag: string | undefined;
    if (addIdx >= 0) {
      // primer arg después de add que no empiece con guion
      for (let i = addIdx + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.startsWith("-")) {
          if ((t === "--skill" || t === "-s") && tokens[i + 1]) {
            skillFlag = tokens[i + 1];
            i++;
          }
          continue;
        }
        if (!target) target = t;
      }
    }
    if (target) {
      // Si llevaba --skill name, convertir a target@name
      if (skillFlag && !target.includes("@")) {
        // Si target es URL → reescribir a owner/repo@skill
        if (/^https?:\/\//i.test(target)) {
          const parsed = parseIdentifier(target);
          return { cliArg: `${parsed.cliArg}@${skillFlag}`, preferredSkillName: skillFlag };
        }
        return { cliArg: `${target}@${skillFlag}`, preferredSkillName: skillFlag };
      }
      trimmed = target;
    }
  }

  // Quitar barra final y normalizar protocolo
  trimmed = trimmed.replace(/\/$/, "").replace(/^http:\/\//, "https://");

  if (trimmed.startsWith("https://skills.sh/")) {
    const rest = trimmed.replace("https://skills.sh/", "");
    const parts = rest.split("/").filter(Boolean);
    if (parts.length >= 3) return { cliArg: `${parts[0]}/${parts[1]}@${parts[2]}`, preferredSkillName: parts[2] };
    if (parts.length === 2) return { cliArg: `${parts[0]}/${parts[1]}` };
  }

  if (trimmed.startsWith("https://github.com/")) {
    const rest = trimmed.replace("https://github.com/", "").replace(/\.git$/, "");
    const parts = rest.split("/").filter(Boolean);
    // owner/repo/tree/branch/skill
    if (parts.length >= 5 && parts[2] === "tree") {
      return { cliArg: `${parts[0]}/${parts[1]}@${parts[4]}`, preferredSkillName: parts[4] };
    }
    if (parts.length >= 2) return { cliArg: `${parts[0]}/${parts[1]}` };
  }

  if (trimmed.includes("@") && !trimmed.startsWith("https://")) {
    const skill = trimmed.split("@")[1];
    return { cliArg: trimmed, preferredSkillName: skill };
  }
  return { cliArg: trimmed };
}

function stripAnsi(s: string): string {
  // remove ANSI escape codes
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\x1b\[\?\d+[A-Za-z]/g, "");
}

function extractInstalledNames(output: string): string[] {
  // El CLI imprime líneas como: "✓ ~\Nueva carpeta\.agents\skills\<name>"
  const cleaned = stripAnsi(output);
  const names = new Set<string>();
  const re = /\.agents[\\/]skills[\\/]([A-Za-z0-9_.-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    names.add(m[1]);
  }
  return [...names];
}

function runNpx(args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number; timedOut: boolean }> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const proc = spawn(isWin ? "npx.cmd" : "npx", args, {
      cwd,
      shell: isWin, // .cmd files need shell on Windows
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "1" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeoutMs);
    proc.stdout.on("data", (b) => (stdout += b.toString("utf-8")));
    proc.stderr.on("data", (b) => (stderr += b.toString("utf-8")));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? -1, timedOut });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + "\n" + e.message, code: -1, timedOut });
    });
  });
}

export async function installSkill(identifier: string): Promise<{
  installed: InstalledSkill[];
  cli_output: string;
  cli_args: string;
  error?: string;
}> {
  const parsed = parseIdentifier(identifier);
  // Sanitize: identifiers should only contain letters, numbers, /, @, ., _, -
  if (!/^[A-Za-z0-9_./@-]+$/.test(parsed.cliArg)) {
    return {
      installed: [],
      cli_output: "",
      cli_args: parsed.cliArg,
      error: `Identificador con caracteres no permitidos: '${parsed.cliArg}'. Usa formato 'owner/repo@skill' o un URL válido.`,
    };
  }
  const cwd = path.resolve(process.cwd(), "..");

  let beforeDirs: string[] = [];
  try {
    beforeDirs = await fs.readdir(SKILLS_ROOT);
  } catch {
    /* doesn't exist yet */
  }

  const args = ["-y", "skills", "add", parsed.cliArg, "-y"];
  const { stdout, stderr, code, timedOut } = await runNpx(args, cwd, 180_000);
  const fullOutput = stdout + "\n" + stderr;
  const cleaned = stripAnsi(fullOutput);

  let afterDirs: string[] = [];
  try {
    afterDirs = await fs.readdir(SKILLS_ROOT);
  } catch {
    /* skip */
  }

  const newDirs = afterDirs.filter((d) => !beforeDirs.includes(d));
  const namesFromOutput = extractInstalledNames(fullOutput);

  // Combinar las detecciones (carpeta nueva o referenciada en el output del CLI)
  const candidates = new Set<string>([...newDirs, ...namesFromOutput]);
  // Si pidió una skill concreta y existe en disco, asegúrate de incluirla
  if (parsed.preferredSkillName && afterDirs.includes(parsed.preferredSkillName)) {
    candidates.add(parsed.preferredSkillName);
  }

  const installed: InstalledSkill[] = [];
  for (const dir of candidates) {
    const skillFile = path.join(SKILLS_ROOT, dir, "SKILL.md");
    try {
      await fs.access(skillFile);
      installed.push({ name: dir, path: skillFile });
    } catch {
      /* skip */
    }
  }

  // Errores
  let error: string | undefined;
  if (timedOut) {
    error = `Timeout: el CLI tardó más de 3 min. Output parcial: ${cleaned.slice(-400)}`;
  } else if (installed.length === 0) {
    if (code !== 0) {
      error = `npx skills add falló (exit ${code}). Output: ${cleaned.slice(-500)}`;
    } else {
      error = `No se detectó ninguna skill instalada. Verifica el identificador. Output: ${cleaned.slice(-500)}`;
    }
  }

  return {
    installed,
    cli_output: cleaned.slice(-2000),
    cli_args: args.join(" "),
    error,
  };
}

export async function listInstalledSkills(): Promise<string[]> {
  try {
    const dirs = await fs.readdir(SKILLS_ROOT);
    const out: string[] = [];
    for (const d of dirs) {
      const file = path.join(SKILLS_ROOT, d, "SKILL.md");
      try {
        await fs.access(file);
        out.push(d);
      } catch {
        /* skip */
      }
    }
    return out.sort();
  } catch {
    return [];
  }
}
