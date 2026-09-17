import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { renderRunPage } from "../src/run/page.js";
import type { RunRecord, TurnRecord } from "../src/types.js";

const writeJson = (path: string, value: unknown): void => writeFileSync(path, JSON.stringify(value), "utf8");

describe("renderRunPage", () => {
  it("injects run data, relative screenshot paths, and refresh only while running", () => {
    const runDir = mkdtempSync(join(tmpdir(), "design-gate-page-"));
    const run: RunRecord = {
      runId: "run-1",
      status: "running",
      startedAt: "2026-09-17T00:00:00.000Z",
      configHash: "c",
      brandHash: "b",
      bankHash: "q",
      keyPresent: true,
      iterations: [
        { turn: 1, at: "2026-09-17T00:01:00.000Z", verdict: "REVISE", overall: 0.5, categories: { brand: 0.5, craft: 0.5, ux: 0.5, a11y: 0.5, pattern: 0.5, copy: 0.5 }, fixesSent: [], fixesResolved: [], fixesPersisted: [], screenshots: [], filesChanged: [], costUsd: 0, cacheHit: false },
        { turn: 2, at: "2026-09-17T00:02:00.000Z", verdict: "APPROVED", overall: 0.9, categories: { brand: 0.9, craft: 0.9, ux: 0.9, a11y: 0.9, pattern: 0.9, copy: 0.9 }, fixesSent: [], fixesResolved: [], fixesPersisted: [], screenshots: [], filesChanged: [], costUsd: 0, cacheHit: false },
      ],
    };
    const turn = (number: number): TurnRecord => ({
      runId: run.runId,
      turn: number,
      screens: [{ key: "/|desktop", screenshotPath: join(runDir, "shots", `root-desktop-${number}.png`) }],
      decision: { verdict: number === 1 ? "REVISE" : "APPROVED", overall: number === 1 ? 0.5 : 0.9, best: 0.9, categories: run.iterations[number - 1]!.categories, hardFailures: [], gateFailures: [], uncertain: [], fixes: [], suppressed: [], signature: "" },
    } as unknown as TurnRecord);
    writeJson(join(runDir, "run.json"), run);
    writeJson(join(runDir, "turn-1.json"), turn(1));
    writeJson(join(runDir, "turn-2.json"), turn(2));

    const page = renderRunPage(runDir);
    const running = readFileSync(page, "utf8");
    expect(running).toContain('"runId":"run-1"');
    expect(running).toContain('"screenshotPath":"shots/root-desktop-1.png"');
    expect(running).toContain('<meta http-equiv="refresh" content="3">');

    writeJson(join(runDir, "run.json"), { ...run, status: "approved" });
    const approved = readFileSync(renderRunPage(runDir), "utf8");
    expect(approved).not.toContain('<meta http-equiv="refresh" content="3">');
  });
});
