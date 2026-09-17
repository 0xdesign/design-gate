import { existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

import { maskKey, resolveAnthropicKey, resolveTypesafeKey } from "../../init/index.js";
import { designGateDir, listRuns, readState } from "../../run/store.js";

const describeKey = (resolved: ReturnType<typeof resolveTypesafeKey>): string =>
  resolved.key ? `${resolved.source} ${maskKey(resolved.key)}` : "none";

export const renderStatus = (cwd = process.cwd()): string => {
  const home = os.homedir();
  const typesafe = resolveTypesafeKey(process.env, home);
  const anthropic = resolveAnthropicKey(process.env, home);
  const state = readState(cwd);
  const run = state.openRunId
    ? listRuns(cwd).find((entry) => entry.runId === state.openRunId) ?? listRuns(cwd)[0]
    : listRuns(cwd)[0];
  const verdict = run?.iterations.at(-1)?.verdict ?? "none";
  return [
    `config: ${existsSync(join(cwd, "design-gate.yml")) ? "present" : "missing"}`,
    `TypeSafe key: ${describeKey(typesafe)}`,
    `Anthropic key: ${describeKey(anthropic)}`,
    `last verdict: ${verdict}`,
    `design-gate dir: ${designGateDir(cwd)}`,
  ].join("\n");
};
