import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { readConfig } from "../../init/index.js";
import { defaultBankPath, loadBank } from "../../judge/index.js";
import { designGateDir, listRuns, readRun, readState, readTurn } from "../../run/store.js";
import { BrandSchema, type Brand, type JevState, type Question, type QuestionResult, type TurnRecord } from "../../types.js";

const latestRunDir = (cwd: string): string => {
  const state = readState(cwd);
  if (state.openRunId) {
    const candidate = join(designGateDir(cwd), "runs", state.openRunId);
    if (existsSync(join(candidate, "run.json"))) return candidate;
  }
  const latest = listRuns(cwd)[0];
  if (!latest) throw new Error("No design-gate runs found.");
  return join(designGateDir(cwd), "runs", latest.runId);
};

const printable = (value: unknown): string => JSON.stringify(value, null, 2);

const questionHeader = (question: Question): string[] => [
  `${question.id}`,
  `text: ${typeof question.instructions === "string" ? question.instructions : printable(question.instructions)}`,
  `type: ${question.type}`,
  `category: ${question.category}`,
  `weight: ${question.weight}`,
  `gate: ${question.gate}`,
  `hidden: ${question.hidden}`,
  `threshold: ${question.threshold}`,
  `criteria: ${printable(question.criteria ?? null)}`,
  `fix: ${question.fix ?? printable(question.fix_by_choice ?? null)}`,
  `refs: ${question.refs.join(", ") || "none"}`,
  `needs: ${question.needs.join(", ")}`,
];

const stateForNeeds = (state: JevState, question: Question): Record<string, unknown> =>
  Object.fromEntries(question.needs.map((need) => [need, state[need]]));

export const explainQuestion = (questionId: string, turnNumber?: number, cwd = process.cwd()): string => {
  const config = readConfig(cwd);
  if (!config) throw new Error("No design-gate.yml. Run `npx design-gate init` first.");
  const bankPath = config.bankFile
    ? (isAbsolute(config.bankFile) ? config.bankFile : resolve(cwd, config.bankFile))
    : defaultBankPath();
  const question = loadBank(bankPath).questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`Unknown question id: ${questionId}`);
  const brandPath = isAbsolute(config.brandFile) ? config.brandFile : resolve(cwd, config.brandFile);
  const fallbackBrand: Brand = existsSync(brandPath)
    ? BrandSchema.parse(JSON.parse(readFileSync(brandPath, "utf8")) as unknown)
    : BrandSchema.parse({});

  const runDir = latestRunDir(cwd);
  const run = readRun(runDir);
  const selectedTurn = turnNumber ?? run.iterations.at(-1)?.turn;
  if (selectedTurn === undefined) throw new Error("The selected run has no completed turns.");
  const turn: TurnRecord = readTurn(runDir, selectedTurn);
  const lines = questionHeader(question);
  for (const screen of turn.screens) {
    const result: QuestionResult | undefined = screen.judge?.results.find((entry) => entry.id === questionId);
    lines.push("", `screen: ${screen.key}`);
    lines.push(result
      ? `result: p=${result.probability.toFixed(3)} confidence=${result.confidence.toFixed(3)} passed=${result.passed}`
      : "result: not evaluated");
    const state = screen.judge?.stateSent ?? {
      brief: { route: screen.route, viewport: screen.viewport },
      brand: fallbackBrand,
      facts: screen.facts,
      ...(screen.observations ? { observations: screen.observations } : {}),
    } as JevState;
    lines.push(`state: ${printable(stateForNeeds(state, question))}`);
  }
  return lines.join("\n");
};
