import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startStaticServer } from "../src/capture/static-server.js";
import { runCheck } from "../src/cli/check.js";
import { compileCrossScreen, compileScreen, deterministicGates } from "../src/facts/index.js";
import { fileHashes, listUiFiles, uiHash } from "../src/run/hash.js";
import { designGateDir, openOrCreateRun, readRun, readTurn } from "../src/run/store.js";
import { BrandSchema } from "../src/types.js";
import { captureFixtureScreens } from "./helpers.js";

const fixture = (name: string): string => resolve(process.cwd(), "fixtures", name);

const project = (name: string): { cwd: string; home: string } => {
  const cwd = mkdtempSync(join(tmpdir(), `design-gate-${name}-`));
  const home = mkdtempSync(join(tmpdir(), "design-gate-home-"));
  cpSync(fixture(name), cwd, { recursive: true });
  return { cwd, home };
};

const writeConfig = (cwd: string, url: string, observer: "none" | "agent"): void => {
  writeFileSync(join(cwd, "design-gate.yml"), JSON.stringify({
    version: 1,
    devServer: { url, autoStart: false },
    routes: ["/", "/pricing.html"],
    uiGlobs: ["**/*.html"],
    brandFile: "brand.json",
    judge: "fake",
    observer,
  }), "utf8");
};

const testServer = async (cwd: string): Promise<{ url: string; restricted: boolean; stop: () => Promise<void> }> => {
  try {
    return { ...(await startStaticServer(cwd)), restricted: false };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("EPERM")) throw error;
    return { url: pathToFileURL(join(cwd, "index.html")).href, restricted: true, stop: async () => undefined };
  }
};

const seedPending = async (cwd: string, fixtureName: "generic-saas" | "on-brand", turn: number): Promise<void> => {
  const opened = openOrCreateRun(cwd, { configHash: "test", brandHash: "test", bankHash: "test", keyPresent: false });
  const brand = BrandSchema.parse(JSON.parse(readFileSync(join(cwd, "brand.json"), "utf8")) as unknown);
  const screens = (await captureFixtureScreens(fixtureName, join(opened.runDir, "shots")))
    .map((snapshot) => compileScreen(snapshot, brand));
  const crossScreen = compileCrossScreen(screens);
  const hashes = fileHashes(cwd, listUiFiles(cwd, ["**/*.html"]));
  writeFileSync(join(opened.runDir, `pending-${turn}.json`), JSON.stringify({
    hash: uiHash(hashes), screens, crossScreen,
    hardFailures: deterministicGates(screens, crossScreen, brand),
  }));
};

afterEach(() => vi.restoreAllMocks());

const quiet = (): void => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
};

describe("runCheck", () => {
  it("persists, caches, and appends generic checks", async () => {
    quiet();
    const { cwd, home } = project("generic-saas");
    const server = await testServer(cwd);
    try {
      writeConfig(cwd, server.url, "none");
      if (server.restricted) await seedPending(cwd, "generic-saas", 1);
      const first = await runCheck({ cwd, home, env: {}, mode: "check", json: true });
      expect(first).toMatchObject({ exitCode: 3, json: { verdict: "REVISE", cacheHit: false } });
      expect(first.json.hardFailures.some((failure) => failure.id === "det.contrast")).toBe(true);
      expect(first.json.fixes.some((fix) => fix.id.startsWith("brand."))).toBe(true);
      const runDir = join(designGateDir(cwd), "runs", first.json.runId);
      for (const file of ["turn-1.json", "turn-1.md", "index.html"]) expect(existsSync(join(runDir, file))).toBe(true);

      const cached = await runCheck({ cwd, home, env: {}, mode: "check", json: true });
      expect(cached.json.cacheHit).toBe(true);
      writeFileSync(join(cwd, "index.html"), `${readFileSync(join(cwd, "index.html"), "utf8")}\n<!-- changed -->\n`);
      if (server.restricted) await seedPending(cwd, "generic-saas", 2);
      const second = await runCheck({ cwd, home, env: {}, mode: "check", json: true });
      expect(readRun(runDir).iterations).toHaveLength(2);
      expect(second.json.turn).toBe(2);
    } finally {
      await server.stop();
    }
  });

  it("approves the on-brand fixture", async () => {
    quiet();
    const { cwd, home } = project("on-brand");
    const server = await testServer(cwd);
    try {
      writeConfig(cwd, server.url, "none");
      if (server.restricted) await seedPending(cwd, "on-brand", 1);
      const result = await runCheck({ cwd, home, env: {}, mode: "check", json: true });
      expect(result).toMatchObject({ exitCode: 0, json: { verdict: "APPROVED" } });
      expect(readRun(join(designGateDir(cwd), "runs", result.json.runId)).status).toBe("approved");
    } finally {
      await server.stop();
    }
  });

  it("waits for agent observations and then reuses the pending capture", async () => {
    quiet();
    const { cwd, home } = project("generic-saas");
    const server = await testServer(cwd);
    try {
      writeConfig(cwd, server.url, "agent");
      if (server.restricted) await seedPending(cwd, "generic-saas", 1);
      const first = await runCheck({ cwd, home, env: {}, mode: "check", json: true });
      expect(first).toMatchObject({ exitCode: 4, json: { verdict: "OBSERVATIONS_NEEDED" } });
      const request = JSON.parse(readFileSync(join(designGateDir(cwd), "observe-request.json"), "utf8")) as {
        runId: string;
        turn: number;
        screens: { key: string }[];
      };
      const runDir = join(designGateDir(cwd), "runs", request.runId);
      expect(readRun(runDir).iterations).toHaveLength(0);
      const observation = {
        screen_type: "landing",
        focal_point: "headline",
        hierarchy_levels: "3",
        reading_order: "clear",
        status_encoding: "na",
        patterns_present: ["hero"],
        generic_traits: ["saas_card_kit"],
        copy: { headline: "Remember everything. Create anything.", primary_cta: "Get started", empty_state: "" },
        mood: ["generic"],
      };
      writeFileSync(join(designGateDir(cwd), "observations.json"), JSON.stringify({
        runId: request.runId,
        turn: request.turn,
        author: "agent",
        screens: Object.fromEntries(request.screens.map((screen) => [screen.key, observation])),
      }), "utf8");
      const second = await runCheck({ cwd, home, env: {}, mode: "check", json: true });
      expect(second.json.verdict).not.toBe("OBSERVATIONS_NEEDED");
      const turn = readTurn(runDir, 1);
      expect(turn.observationsAuthor).toBe("agent");
      expect(turn.observationsSha256).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      await server.stop();
    }
  });

  it("keeps report runs isolated from state and handles missing config", async () => {
    quiet();
    const { cwd, home } = project("on-brand");
    const server = await testServer(cwd);
    try {
      writeConfig(cwd, server.url, "none");
      mkdirSync(designGateDir(cwd), { recursive: true });
      writeFileSync(join(designGateDir(cwd), "state.json"), JSON.stringify({ fileHashes: { sentinel: "yes" } }));
      const before = readFileSync(join(designGateDir(cwd), "state.json"), "utf8");
      const report = await runCheck({ cwd, home, env: {}, mode: "report", json: true });
      expect(report.json.runPage).toContain(".design-gate/reports/");
      expect(readFileSync(join(designGateDir(cwd), "state.json"), "utf8")).toBe(before);
    } finally {
      await server.stop();
    }

    const missing = mkdtempSync(join(tmpdir(), "design-gate-missing-"));
    const result = await runCheck({ cwd: missing, home, env: {}, mode: "check", json: true });
    expect(result.exitCode).toBe(2);
    expect(result.json.notes).toContain("No design-gate.yml. Run `npx design-gate init` first.");
  });
});
