import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { changedFiles, fileHashes, listUiFiles, uiHash } from "../src/run/hash.js";
import { formatUsd, jevCostUsd } from "../src/run/cost.js";
import {
  addWaiver,
  appendTurn,
  finalizeRun,
  listRuns,
  openOrCreateRun,
  readRun,
  readTurn,
  readWaivers,
  waiversPath,
} from "../src/run/store.js";
import type { TurnRecord, TurnSummary } from "../src/types.js";

describe("run hashing and provenance store", () => {
  it("computes Jev input-token cost", () => {
    expect(jevCostUsd({ input_tokens: 1_000_000, output_tokens: 99 })).toBe(0.042);
    expect(formatUsd(0.000042)).toBe("$0.000042");
  });

  it("hashes matching UI files and reports added, changed, and removed paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "design-gate-hash-"));
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, "node_modules"));
    writeFileSync(join(cwd, "src", "app.tsx"), "export const App = () => <main />;");
    writeFileSync(join(cwd, "src", "app.css"), "main {}\n");
    writeFileSync(join(cwd, "node_modules", "ignored.css"), "* {}\n");
    const files = listUiFiles(cwd, ["src/**/*.{tsx,css}", "**/*.css"]);
    expect(files).toEqual(["src/app.css", "src/app.tsx"]);
    const first = fileHashes(cwd, files);
    const firstHash = uiHash(first);
    writeFileSync(join(cwd, "src", "app.css"), "main { color: red; }\n");
    writeFileSync(join(cwd, "src", "new.css"), "p {}\n");
    const second = fileHashes(cwd, listUiFiles(cwd, ["src/**/*.{tsx,css}"]));
    expect(uiHash(first)).toBe(firstHash);
    expect(changedFiles(first, second)).toEqual(["src/app.css", "src/new.css"]);
  });

  it("creates, appends, finalizes, reads, and lists runs", () => {
    const cwd = mkdtempSync(join(tmpdir(), "design-gate-store-"));
    const opened = openOrCreateRun(cwd, { configHash: "c", brandHash: "b", bankHash: "q", keyPresent: true });
    expect(opened.created).toBe(true);
    expect(existsSync(join(opened.runDir, "shots"))).toBe(true);
    expect(openOrCreateRun(cwd, { configHash: "c2", brandHash: "b2", bankHash: "q2", keyPresent: false }).created).toBe(false);

    const summary: TurnSummary = {
      turn: 1, at: new Date().toISOString(), verdict: "APPROVED", overall: 0.9,
      categories: { brand: 0.9, craft: 0.9, ux: 0.9, a11y: 0.9, pattern: 0.9, copy: 0.9 },
      fixesSent: [], fixesResolved: [], fixesPersisted: [], screenshots: [], filesChanged: [], costUsd: 0, cacheHit: false,
    };
    const record = { runId: opened.run.runId, turn: 1, at: summary.at } as TurnRecord;
    appendTurn(opened.runDir, record, summary);
    expect(existsSync(join(opened.runDir, "turn-1.json"))).toBe(true);
    expect(readTurn(opened.runDir, 1).turn).toBe(1);
    expect(readRun(opened.runDir).iterations).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(opened.runDir, "run.json"), "utf8")).iterations[0].turn).toBe(1);
    finalizeRun(opened.runDir, "approved");
    expect(readRun(opened.runDir).status).toBe("approved");
    expect(listRuns(cwd).map((run) => run.runId)).toContain(opened.run.runId);
  });

  it("stores project-scoped waivers under a fake home", () => {
    const home = mkdtempSync(join(tmpdir(), "design-gate-home-"));
    const cwd = mkdtempSync(join(tmpdir(), "design-gate-project-"));
    const added = addWaiver(home, cwd, { id: "brand.palette", reason: "campaign exception", by: "designer" });
    expect(waiversPath(home, cwd)).toMatch(/\.design-gate\/waivers\/[a-f0-9]{12}\.json$/);
    expect(readWaivers(home, cwd)).toEqual([added]);
  });
});
