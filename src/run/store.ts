import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

import type { RunRecord, TurnRecord, TurnSummary } from "../types.js";

export interface RunState {
  lastUiHash?: string;
  fileHashes: Record<string, string>;
  openRunId?: string;
}

export interface Waiver {
  id: string;
  reason: string;
  by: string;
  at: string;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function designGateDir(cwd: string): string {
  return join(resolve(cwd), ".design-gate");
}

export function readState(cwd: string): RunState {
  const path = join(designGateDir(cwd), "state.json");
  if (!existsSync(path)) return { fileHashes: {} };
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<RunState>;
  return {
    ...(typeof raw.lastUiHash === "string" ? { lastUiHash: raw.lastUiHash } : {}),
    fileHashes: raw.fileHashes && typeof raw.fileHashes === "object" ? raw.fileHashes : {},
    ...(typeof raw.openRunId === "string" ? { openRunId: raw.openRunId } : {}),
  };
}

export function writeState(cwd: string, state: RunState): void {
  const directory = designGateDir(cwd);
  mkdirSync(directory, { recursive: true });
  writeJson(join(directory, "state.json"), state);
}

export function newRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export function readRun(runDir: string): RunRecord {
  return JSON.parse(readFileSync(join(resolve(runDir), "run.json"), "utf8")) as RunRecord;
}

export function readTurn(runDir: string, turn: number): TurnRecord {
  return JSON.parse(readFileSync(join(resolve(runDir), `turn-${turn}.json`), "utf8")) as TurnRecord;
}

export function openOrCreateRun(
  cwd: string,
  meta: {
    configHash: string;
    brandHash: string;
    bankHash: string;
    keyPresent: boolean;
    task?: string;
  },
): { run: RunRecord; runDir: string; created: boolean } {
  const state = readState(cwd);
  const root = designGateDir(cwd);
  const runsDir = join(root, "runs");
  mkdirSync(runsDir, { recursive: true });

  if (state.openRunId) {
    const existingDir = join(runsDir, state.openRunId);
    try {
      const existing = readRun(existingDir);
      if (existing.status === "running") {
        return { run: existing, runDir: existingDir, created: false };
      }
    } catch {
      // A missing/corrupt open run is replaced with a new provenance record.
    }
  }

  const runId = newRunId();
  const runDir = join(runsDir, runId);
  mkdirSync(join(runDir, "shots"), { recursive: true });
  const run: RunRecord = {
    runId,
    status: "running",
    startedAt: new Date().toISOString(),
    ...(meta.task === undefined ? {} : { task: meta.task }),
    configHash: meta.configHash,
    brandHash: meta.brandHash,
    bankHash: meta.bankHash,
    keyPresent: meta.keyPresent,
    iterations: [],
  };
  writeJson(join(runDir, "run.json"), run);
  writeState(cwd, { ...state, openRunId: runId });
  return { run, runDir, created: true };
}

export function appendTurn(runDir: string, record: TurnRecord, summary: TurnSummary): void {
  const directory = resolve(runDir);
  writeJson(join(directory, `turn-${record.turn}.json`), record);
  const run = readRun(directory);
  const previous = run.iterations.filter((iteration) => iteration.turn !== summary.turn);
  run.iterations = [...previous, summary].sort((left, right) => left.turn - right.turn);
  writeJson(join(directory, "run.json"), run);
}

export function finalizeRun(
  runDir: string,
  status: Exclude<RunRecord["status"], "running">,
): void {
  const run = readRun(runDir);
  run.status = status;
  run.endedAt = new Date().toISOString();
  writeJson(join(resolve(runDir), "run.json"), run);
}

export function listRuns(cwd: string): RunRecord[] {
  const runsDir = join(designGateDir(cwd), "runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [readRun(join(runsDir, entry.name))];
      } catch {
        return [];
      }
    })
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

function projectSlug(cwd: string): string {
  return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12);
}

export function waiversPath(home: string, cwd = process.cwd()): string {
  return join(resolve(home), ".design-gate", "waivers", `${projectSlug(cwd)}.json`);
}

function isWaiver(value: unknown): value is Waiver {
  if (value === null || typeof value !== "object") return false;
  const item = value as Partial<Waiver>;
  return typeof item.id === "string"
    && typeof item.reason === "string"
    && typeof item.by === "string"
    && typeof item.at === "string";
}

export function readWaivers(home: string, cwd = process.cwd()): Waiver[] {
  const path = waiversPath(home, cwd);
  if (!existsSync(path)) return [];
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  return Array.isArray(raw) ? raw.filter(isWaiver) : [];
}

export function addWaiver(
  home: string,
  cwd: string,
  waiver: { id: string; reason: string; by: string },
): Waiver {
  const path = waiversPath(home, cwd);
  mkdirSync(resolve(path, ".."), { recursive: true });
  const added: Waiver = { ...waiver, at: new Date().toISOString() };
  const existing = readWaivers(home, cwd).filter((entry) => entry.id !== waiver.id);
  writeJson(path, [...existing, added]);
  return added;
}

export function runIdFromDir(runDir: string): string {
  return basename(resolve(runDir));
}
