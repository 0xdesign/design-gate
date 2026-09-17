import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type AgentId =
  | "claude-code"
  | "codex"
  | "cursor"
  | "gemini"
  | "copilot"
  | "windsurf"
  | "agents-std";

export interface AgentTarget {
  id: AgentId;
  detected: boolean;
  evidence: string[];
  skillDir: string;
}

interface AgentDefinition {
  id: AgentId;
  evidence: (cwd: string, home: string) => string[];
  skillDir: (cwd: string) => string;
}

const existing = (candidates: string[]): string[] => candidates.filter((candidate) => existsSync(candidate));

const AGENTS: AgentDefinition[] = [
  {
    id: "claude-code",
    evidence: (cwd, home) => existing([path.join(cwd, ".claude"), path.join(home, ".claude"), path.join(cwd, "CLAUDE.md")]),
    skillDir: (cwd) => path.join(cwd, ".claude", "skills", "design-gate"),
  },
  {
    id: "codex",
    evidence: (cwd, home) => existing([path.join(cwd, ".codex"), path.join(home, ".codex"), path.join(cwd, "AGENTS.md")]),
    skillDir: (cwd) => path.join(cwd, ".agents", "skills", "design-gate"),
  },
  {
    id: "cursor",
    evidence: (cwd, home) => existing([path.join(cwd, ".cursor"), path.join(home, ".cursor")]),
    skillDir: (cwd) => path.join(cwd, ".cursor", "skills", "design-gate"),
  },
  {
    id: "gemini",
    evidence: (cwd, home) => existing([path.join(cwd, ".gemini"), path.join(home, ".gemini")]),
    skillDir: (cwd) => path.join(cwd, ".gemini", "skills", "design-gate"),
  },
  {
    id: "copilot",
    evidence: (cwd, home) => existing([path.join(cwd, ".github", "copilot-instructions.md"), path.join(home, ".copilot")]),
    skillDir: (cwd) => path.join(cwd, ".github", "skills", "design-gate"),
  },
  {
    id: "windsurf",
    evidence: (cwd, home) => existing([path.join(cwd, ".windsurf"), path.join(home, ".codeium")]),
    skillDir: (cwd) => path.join(cwd, ".windsurf", "skills", "design-gate"),
  },
  {
    id: "agents-std",
    evidence: (cwd) => existing([path.join(cwd, ".agents")]),
    skillDir: (cwd) => path.join(cwd, ".agents", "skills", "design-gate"),
  },
];

export function detectAgents(cwd: string, home = os.homedir()): AgentTarget[] {
  return AGENTS.map((definition) => {
    const evidence = definition.evidence(cwd, home);
    return {
      id: definition.id,
      detected: evidence.length > 0,
      evidence,
      skillDir: definition.skillDir(cwd),
    };
  });
}

export function installSkill(
  cwd: string,
  targets: AgentTarget[],
  skillSourceDir: string,
): { installed: string[]; skipped: string[] } {
  const detected = targets.filter((target) => target.detected);
  const destinations = detected.length > 0
    ? detected.map((target) => target.skillDir)
    : [
        path.join(cwd, ".agents", "skills", "design-gate"),
        path.join(cwd, ".claude", "skills", "design-gate"),
      ];
  const installed: string[] = [];
  const skipped: string[] = [];

  for (const destination of [...new Set(destinations)]) {
    try {
      mkdirSync(destination, { recursive: true });
      cpSync(skillSourceDir, destination, { recursive: true, force: true });
      installed.push(destination);
    } catch {
      skipped.push(destination);
    }
  }

  return { installed, skipped };
}

export function resolveSkillSourceDir(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  const root = path.parse(current).root;

  while (current !== root) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
        if (parsed.name === "design-gate") return path.join(current, "skills", "design-gate");
      } catch {
        // Keep walking if this package.json is malformed or belongs to another package.
      }
    }
    current = path.dirname(current);
  }

  throw new Error("Could not locate the design-gate package root");
}
