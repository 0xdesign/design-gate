import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectAgents, installSkill } from "../src/init/agents.js";

async function tempDirectory(label: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), `design-gate-${label}-`));
}

function write(file: string, contents = ""): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

describe("agent skill installation", () => {
  it("detects evidence and installs recursively into every detected target", async () => {
    const cwd = await tempDirectory("agents");
    const home = await tempDirectory("home");
    mkdirSync(path.join(cwd, ".cursor"));
    mkdirSync(path.join(cwd, ".gemini"));
    mkdirSync(path.join(home, ".claude"));
    write(path.join(cwd, "AGENTS.md"));
    const source = await tempDirectory("skill");
    write(path.join(source, "SKILL.md"), "v1");
    write(path.join(source, "references", "guide.md"), "guide");

    const agents = detectAgents(cwd, home);
    expect(agents.find((agent) => agent.id === "claude-code")?.detected).toBe(true);
    expect(agents.find((agent) => agent.id === "codex")?.detected).toBe(true);
    expect(agents.find((agent) => agent.id === "cursor")?.detected).toBe(true);
    expect(agents.find((agent) => agent.id === "gemini")?.detected).toBe(true);

    const result = installSkill(cwd, agents, source);
    expect(result.skipped).toEqual([]);
    for (const target of agents.filter((agent) => agent.detected)) {
      expect(readFileSync(path.join(target.skillDir, "SKILL.md"), "utf8")).toBe("v1");
      expect(readFileSync(path.join(target.skillDir, "references", "guide.md"), "utf8")).toBe("guide");
    }

    write(path.join(source, "SKILL.md"), "v2");
    const rerun = installSkill(cwd, agents, source);
    expect(rerun.installed).toEqual(result.installed);
    expect(readFileSync(path.join(agents.find((agent) => agent.id === "codex")!.skillDir, "SKILL.md"), "utf8")).toBe("v2");
  });

  it("uses agents-standard and Claude fallback targets when nothing is detected", async () => {
    const cwd = await tempDirectory("fallback");
    const home = await tempDirectory("empty-home");
    const source = await tempDirectory("fallback-skill");
    write(path.join(source, "SKILL.md"), "fallback");
    const agents = detectAgents(cwd, home);
    expect(agents.every((agent) => !agent.detected)).toBe(true);

    const result = installSkill(cwd, agents, source);
    expect(result.installed).toEqual([
      path.join(cwd, ".agents", "skills", "design-gate"),
      path.join(cwd, ".claude", "skills", "design-gate"),
    ]);
    expect(readFileSync(path.join(cwd, ".agents", "skills", "design-gate", "SKILL.md"), "utf8")).toBe("fallback");
    expect(readFileSync(path.join(cwd, ".claude", "skills", "design-gate", "SKILL.md"), "utf8")).toBe("fallback");
  });
});
