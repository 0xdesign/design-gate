import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { isMissingBrowserError, MISSING_BROWSER_HINT } from "../capture/browser.js";
import { captureAll, DevServerUnreachableError, ensureDevServer } from "../capture/playwright.js";
import { decide } from "../decide/decide.js";
import { compileCrossScreen } from "../facts/cross.js";
import { compileScreen } from "../facts/compile.js";
import { deterministicGates } from "../facts/gates.js";
import { readConfig, resolveAnthropicKey, resolveTypesafeKey } from "../init/index.js";
import {
  applicableQuestions,
  bankHash,
  buildState,
  createJudge,
  defaultBankPath,
  FakeJudge,
  loadBank,
} from "../judge/index.js";
import { readObservations, writeObserveRequest } from "../observe/agent.js";
import { observeWithClaude } from "../observe/claude.js";
import { renderMarkdown } from "../report/markdown.js";
import { buildCheckJson, type CheckJson } from "../report/json.js";
import { renderHuman } from "../report/terminal.js";
import { jevCostUsd } from "../run/cost.js";
import { changedFiles, fileHashes, listUiFiles, uiHash } from "../run/hash.js";
import { renderRunPage } from "../run/page.js";
import {
  appendTurn,
  designGateDir,
  finalizeRun,
  newRunId,
  openOrCreateRun,
  readRun,
  readState,
  readTurn,
  readWaivers,
  writeState,
} from "../run/store.js";
import {
  BrandSchema,
  type Brand,
  type Decision,
  type GateFailure,
  type Judge,
  type JudgeResult,
  type Observations,
  type RunRecord,
  type ScreenAnalysis,
  type TurnRecord,
  type TurnSummary,
  type Verdict,
} from "../types.js";

export interface RunCheckOptions {
  cwd: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  mode: "check" | "report";
  json: boolean;
  routes?: string[];
  noVision?: boolean;
  judgeOverride?: "jev" | "fake";
  task?: string;
  log?: (message: string) => void;
}

interface PendingCapture {
  hash: string;
  screens: ScreenAnalysis[];
  crossScreen: ReturnType<typeof compileCrossScreen>;
  hardFailures: GateFailure[];
}

const sha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const outputResult = (opts: RunCheckOptions, json: CheckJson): void => {
  const human = renderHuman(json);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(json)}\n`);
    process.stderr.write(`${human}\n`);
  } else {
    process.stdout.write(`${human}\n`);
  }
};

const exitCodeFor = (verdict: Verdict): number => {
  switch (verdict) {
    case "APPROVED":
    case "SKIPPED": return 0;
    case "REVISE": return 3;
    case "OBSERVATIONS_NEEDED": return 4;
    case "ESCALATE": return 5;
    case "STOP": return 6;
  }
};

const emptyResult = (opts: RunCheckOptions, reason: string, exitCode: number): { json: CheckJson; exitCode: number } => {
  const json = buildCheckJson({
    cwd: opts.cwd,
    runId: "none",
    turn: 0,
    runPage: join(opts.cwd, ".design-gate", "index.html"),
    verdict: "SKIPPED",
    reason,
    notes: [reason],
  });
  outputResult(opts, json);
  return { json, exitCode };
};

const readBrand = (cwd: string, brandFile: string): { brand: Brand; present: boolean; hash: string } => {
  const path = isAbsolute(brandFile) ? brandFile : resolve(cwd, brandFile);
  if (!existsSync(path)) {
    const brand = BrandSchema.parse({});
    return { brand, present: false, hash: sha256(brand) };
  }
  const brand = BrandSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  return { brand, present: true, hash: sha256(brand) };
};

const createReportRun = (cwd: string, meta: Omit<RunRecord, "runId" | "status" | "startedAt" | "iterations">): {
  run: RunRecord;
  runDir: string;
} => {
  const runId = newRunId();
  const runDir = join(designGateDir(cwd), "reports", runId);
  mkdirSync(join(runDir, "shots"), { recursive: true });
  const run: RunRecord = {
    runId,
    status: "running",
    startedAt: new Date().toISOString(),
    ...meta,
    iterations: [],
  };
  writeFileSync(join(runDir, "run.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  return { run, runDir };
};

const cachedResult = (opts: RunCheckOptions, state: ReturnType<typeof readState>, hash: string): CheckJson | null => {
  if (opts.mode !== "check" || state.lastUiHash !== hash || !state.openRunId) return null;
  const runDir = join(designGateDir(opts.cwd), "runs", state.openRunId);
  try {
    const run = readRun(runDir);
    const summary = run.iterations.at(-1);
    if (!summary || summary.verdict === "OBSERVATIONS_NEEDED") return null;
    const record = readTurn(runDir, summary.turn);
    return buildCheckJson({
      cwd: opts.cwd,
      runId: run.runId,
      turn: record.turn,
      runPage: join(runDir, "index.html"),
      decision: record.decision,
      notes: record.notes,
      screenshots: record.screens.map((screen) => ({ key: screen.key, path: screen.screenshotPath })),
      usage: record.usage,
      cacheHit: true,
    });
  } catch {
    return null;
  }
};

const loadPending = (path: string, hash: string): PendingCapture | null => {
  if (!existsSync(path)) return null;
  try {
    const pending = JSON.parse(readFileSync(path, "utf8")) as PendingCapture;
    return pending.hash === hash && Array.isArray(pending.screens) ? pending : null;
  } catch {
    return null;
  }
};

const terminalStatus = (decision: Decision): Exclude<RunRecord["status"], "running"> | null => {
  switch (decision.verdict) {
    case "APPROVED": return "approved";
    case "ESCALATE": return "escalated";
    case "STOP": return "stopped";
    default: return null;
  }
};

const decisionFailures = (failures: GateFailure[]): GateFailure[] => {
  const seen = new Set<string>();
  return failures.filter((failure) => {
    if (seen.has(failure.id)) return false;
    seen.add(failure.id);
    return true;
  });
};

const judgeErrorResult = (
  state: ReturnType<typeof buildState>,
  model: string,
  error: unknown,
  latencyMs: number,
): JudgeResult => ({
  screenKey: `${state.brief.route}|${state.brief.viewport}`,
  model,
  results: [],
  latencyMs,
  error: error instanceof Error ? error.message : String(error),
  stateSent: state,
});

export const runCheck = async (opts: RunCheckOptions): Promise<{ json: CheckJson; exitCode: number }> => {
  const cwd = resolve(opts.cwd);
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  let config;
  try {
    config = readConfig(cwd);
  } catch (error) {
    return emptyResult(opts, error instanceof Error ? error.message : String(error), 2);
  }
  if (config === null) return emptyResult(opts, "No design-gate.yml. Run `npx design-gate init` first.", 2);

  let brandInfo: ReturnType<typeof readBrand>;
  let bank: ReturnType<typeof loadBank>;
  try {
    brandInfo = readBrand(cwd, config.brandFile);
    const bankPath = config.bankFile
      ? (isAbsolute(config.bankFile) ? config.bankFile : resolve(cwd, config.bankFile))
      : defaultBankPath();
    bank = loadBank(bankPath);
  } catch (error) {
    return emptyResult(opts, error instanceof Error ? error.message : String(error), 2);
  }

  const resolvedKey = resolveTypesafeKey(env, home);
  const keyPresent = resolvedKey.key !== null;
  const files = listUiFiles(cwd, config.uiGlobs);
  const hashes = fileHashes(cwd, files);
  const hash = uiHash(hashes);
  const state = readState(cwd);
  const cached = cachedResult({ ...opts, cwd }, state, hash);
  if (cached) {
    outputResult(opts, cached);
    return { json: cached, exitCode: exitCodeFor(cached.verdict) };
  }
  const filesChanged = changedFiles(state.fileHashes, hashes);
  const meta = {
    configHash: sha256(config),
    brandHash: brandInfo.hash,
    bankHash: bankHash(bank),
    keyPresent,
    ...(opts.task === undefined ? {} : { task: opts.task }),
  };
  const opened = opts.mode === "check"
    ? openOrCreateRun(cwd, meta)
    : createReportRun(cwd, meta);
  const { runDir } = opened;
  const run = readRun(runDir);
  const turn = run.iterations.length + 1;
  const runPage = join(runDir, "index.html");

  const skipped = (reason: string): { json: CheckJson; exitCode: number } => {
    const discardRun = (opened as { created?: boolean }).created === true && run.iterations.length === 0;
    if (discardRun) rmSync(runDir, { recursive: true, force: true });
    else if (!existsSync(runPage)) renderRunPage(runDir);
    const json = buildCheckJson({
      cwd,
      runId: run.runId,
      turn,
      runPage: discardRun ? "" : runPage,
      verdict: "SKIPPED",
      reason,
      notes: [reason],
    });
    outputResult(opts, json);
    return { json, exitCode: 0 };
  };

  if (!config.enabled) return skipped("disabled");

  let server: Awaited<ReturnType<typeof ensureDevServer>> | undefined;
  try {
    try {
      server = config.devServer.url.startsWith("file://")
        ? { url: config.devServer.url, started: false, stop: async () => undefined }
        : await ensureDevServer(config, {
          cwd,
          log: opts.log ?? ((message) => process.stderr.write(`${message}\n`)),
        });
    } catch (error) {
      if (error instanceof DevServerUnreachableError) return skipped(error.message);
      throw error;
    }

    const pendingPath = join(runDir, `pending-${turn}.json`);
    let pending = loadPending(pendingPath, hash);
    if (pending === null) {
      try {
        const snapshots = await captureAll(config, server.url, join(runDir, "shots"), {
          routes: opts.routes ?? config.routes,
          turn,
        });
        const screens = snapshots.map((snapshot) => compileScreen(snapshot, brandInfo.brand));
        const crossScreen = compileCrossScreen(screens);
        const hardFailures = deterministicGates(screens, crossScreen, brandInfo.brand);
        pending = { hash, screens, crossScreen, hardFailures };
        writeFileSync(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, "utf8");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return skipped(isMissingBrowserError(message) ? MISSING_BROWSER_HINT : `capture failed: ${message.split("\n")[0]}`);
      }
    }

    const notes: string[] = [];
    const observations = new Map<string, Observations>();
    let observationsAuthor: TurnRecord["observationsAuthor"] = "none";
    let observationsSha256: string | undefined;
    const observer = opts.noVision ? "none" : config.observer;
    if (observer === "agent") {
      const read = readObservations(designGateDir(cwd), run.runId, turn);
      let observationProblem: string | null = null;
      if ("missing" in read) observationProblem = "Observations are missing.";
      else if ("stale" in read) observationProblem = `Observations are stale: ${read.reason}.`;
      else if ("invalid" in read) observationProblem = `Observations are invalid: ${read.errors.join("; ")}`;
      else {
        const missing = pending.screens
          .map((screen) => `${screen.snapshot.route}|${screen.snapshot.viewport.name}`)
          .filter((key) => read.file.screens[key] === undefined);
        if (missing.length > 0) observationProblem = `Observations are invalid: missing screens ${missing.join(", ")}`;
        else {
          for (const [key, value] of Object.entries(read.file.screens)) observations.set(key, value);
          observationsAuthor = "agent";
          observationsSha256 = read.sha256;
        }
      }
      if (observationProblem) {
        notes.push(observationProblem, "View every screenshot in the observe request, write .design-gate/observations.json, then re-run `design-gate check`.");
        const request = writeObserveRequest(designGateDir(cwd), {
          runId: run.runId,
          turn,
          screens: pending.screens.map((screen) => ({
            key: `${screen.snapshot.route}|${screen.snapshot.viewport.name}`,
            route: screen.snapshot.route,
            viewport: screen.snapshot.viewport.name,
            screenshotPath: screen.snapshot.screenshotPath,
          })),
        });
        renderRunPage(runDir);
        const json = buildCheckJson({
          cwd,
          runId: run.runId,
          turn,
          runPage,
          verdict: "OBSERVATIONS_NEEDED",
          notes,
          observeRequest: join(designGateDir(cwd), "observe-request.json"),
          screenshots: request.screens.map((screen) => ({ key: screen.key, path: screen.screenshotPath })),
        });
        outputResult(opts, json);
        return { json, exitCode: 4 };
      }
    } else if (observer === "api") {
      const anthropic = resolveAnthropicKey(env, home);
      for (const screen of pending.screens) {
        const key = `${screen.snapshot.route}|${screen.snapshot.viewport.name}`;
        const result = await observeWithClaude({
          screenshotPath: screen.snapshot.screenshotPath,
          route: screen.snapshot.route,
          viewport: screen.snapshot.viewport.name,
          model: config.observerModel,
          ...(anthropic.key ? { apiKey: anthropic.key } : {}),
        });
        if (result.ok) observations.set(key, result.observations);
        else notes.push(`observer error: ${result.reason}`);
      }
      if (observations.size > 0) {
        observationsAuthor = "api";
        observationsSha256 = sha256(Object.fromEntries(observations));
      }
    }

    const judgeKind = opts.judgeOverride ?? config.judge;
    let judge: Judge | undefined;
    if (judgeKind === "fake") judge = new FakeJudge();
    else if (resolvedKey.key) judge = createJudge("jev", { apiKey: resolvedKey.key, model: config.jevModel });
    else notes.push("KEY NEEDED");

    const screenRecords: TurnRecord["screens"] = [];
    for (const screen of pending.screens) {
      const key = `${screen.snapshot.route}|${screen.snapshot.viewport.name}`;
      const screenObservations = observations.get(key);
      const stateSent = buildState({
        route: screen.snapshot.route,
        viewport: screen.snapshot.viewport.name,
        brand: brandInfo.brand,
        facts: screen.facts,
        cross: pending.crossScreen,
        ...(screenObservations ? { observations: screenObservations } : {}),
      });
      let judgeResult: JudgeResult | undefined;
      if (judge) {
        const questions = applicableQuestions(bank, {
          intent: brandInfo.brand.intent,
          hasObservations: screenObservations !== undefined,
          hasBrand: brandInfo.present,
        });
        const started = Date.now();
        try {
          judgeResult = await judge.judge(stateSent, questions);
        } catch (error) {
          judgeResult = judgeErrorResult(stateSent, judgeKind === "fake" ? "fake" : config.jevModel, error, Date.now() - started);
          notes.push(`judge error: ${judgeResult.error ?? "unknown error"}`);
          notes.push(`Jev questions skipped for ${key}.`);
        }
      }
      screenRecords.push({
        key,
        route: screen.snapshot.route,
        viewport: screen.snapshot.viewport.name,
        screenshotPath: screen.snapshot.screenshotPath,
        screenshotSha256: screen.snapshot.screenshotSha256,
        facts: screen.facts,
        measurements: screen.measurements,
        ...(screenObservations ? { observations: screenObservations } : {}),
        ...(judgeResult ? { judge: judgeResult } : {}),
      });
    }

    const previousRecords = run.iterations.map((iteration) => readTurn(runDir, iteration.turn));
    const waivers = readWaivers(home, cwd);
    const judgeSucceeded = judgeKind === "fake" || screenRecords.some((screen) => screen.judge && !screen.judge.error);
    const decision = decide({
      turn,
      screens: screenRecords.map((screen) => ({ key: screen.key, ...(screen.judge ? { judge: screen.judge } : {}) })),
      hardFailures: decisionFailures(pending.hardFailures),
      questions: bank.questions,
      previous: previousRecords.map((record, index) => ({
        decision: record.decision,
        fixesSent: run.iterations[index]?.fixesSent ?? record.decision.fixes.map((fix) => fix.id),
      })),
      thresholds: config.thresholds,
      categoryWeights: config.categoryWeights,
      waivers: waivers.map((waiver) => waiver.id),
      keyPresent: judge !== undefined && judgeSucceeded,
    });
    if (judge !== undefined && !judgeSucceeded && decision.reason?.includes("KEY NEEDED")) {
      decision.reason = decision.reason.replace("facts-only (KEY NEEDED)", "judge unavailable; deterministic gates only")
        .replace("(facts-only; KEY NEEDED)", "(judge unavailable; deterministic gates only)");
    }

    const usage = screenRecords.reduce((total, screen) => ({
      inputTokens: total.inputTokens + (screen.judge?.usage?.input_tokens ?? 0),
      outputTokens: total.outputTokens + (screen.judge?.usage?.output_tokens ?? 0),
      latencyMs: total.latencyMs + (screen.judge?.latencyMs ?? 0),
    }), { inputTokens: 0, outputTokens: 0, latencyMs: 0 });
    const fullUsage: TurnRecord["usage"] = {
      ...usage,
      costUsd: jevCostUsd({ input_tokens: usage.inputTokens, output_tokens: usage.outputTokens }),
      ...(judge ? { model: judgeKind === "fake" ? "fake" : config.jevModel } : {}),
    };
    const at = new Date().toISOString();
    const priorFixes = new Set(previousRecords.at(-1)?.decision.fixes.map((fix) => fix.id) ?? []);
    const currentFixes = new Set(decision.fixes.map((fix) => fix.id));
    const record: TurnRecord = {
      runId: run.runId,
      turn,
      at,
      uiHash: hash,
      cacheHit: false,
      keyPresent,
      observationsAuthor,
      ...(observationsSha256 ? { observationsSha256 } : {}),
      screens: screenRecords,
      crossScreen: pending.crossScreen,
      hardFailures: pending.hardFailures,
      decision,
      usage: fullUsage,
      filesChanged,
      waivers,
      notes,
    };
    const summary: TurnSummary = {
      turn,
      at,
      verdict: decision.verdict,
      overall: decision.overall,
      categories: decision.categories,
      fixesSent: [...currentFixes],
      fixesResolved: [...priorFixes].filter((id) => !currentFixes.has(id)),
      fixesPersisted: [...priorFixes].filter((id) => currentFixes.has(id)),
      screenshots: screenRecords.map((screen) => ({ key: screen.key, path: screen.screenshotPath })),
      filesChanged,
      costUsd: fullUsage.costUsd,
      cacheHit: false,
    };

    appendTurn(runDir, record, summary);
    const status = terminalStatus(decision);
    if (status) finalizeRun(runDir, status);
    if (opts.mode === "check") writeState(cwd, { lastUiHash: hash, fileHashes: hashes, openRunId: run.runId });
    if (existsSync(pendingPath)) unlinkSync(pendingPath);

    const json = buildCheckJson({
      cwd,
      runId: run.runId,
      turn,
      runPage,
      decision,
      notes,
      screenshots: screenRecords.map((screen) => ({ key: screen.key, path: screen.screenshotPath })),
      usage: fullUsage,
      cacheHit: false,
    });
    writeFileSync(join(runDir, `turn-${turn}.md`), renderMarkdown(json), "utf8");
    renderRunPage(runDir);
    outputResult(opts, json);
    return { json, exitCode: exitCodeFor(decision.verdict) };
  } catch (error) {
    return emptyResult(opts, error instanceof Error ? error.message : String(error), 2);
  } finally {
    await server?.stop();
  }
};
