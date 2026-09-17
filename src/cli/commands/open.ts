import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { designGateDir, listRuns, readState } from "../../run/store.js";

export const latestRunPage = (cwd = process.cwd()): string => {
  const state = readState(cwd);
  const runId = state.openRunId ?? listRuns(cwd)[0]?.runId;
  if (!runId) throw new Error("No design-gate runs found.");
  const page = join(designGateDir(cwd), "runs", runId, "index.html");
  if (!existsSync(page)) throw new Error(`Run page does not exist: ${page}`);
  return page;
};

export const openLatestRun = (): string => {
  const page = latestRunPage();
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  const child = spawn(command, [page], {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
  });
  child.on("error", () => undefined);
  child.unref();
  return page;
};
