import { formatUsd } from "../../run/cost.js";
import { listRuns } from "../../run/store.js";

export const renderRuns = (cwd = process.cwd()): string => {
  const runs = listRuns(cwd);
  const header = ["runId", "status", "turns", "best", "cost", "started"].join("\t");
  return [header, ...runs.map((run) => {
    const best = run.iterations.length > 0 ? Math.max(...run.iterations.map((turn) => turn.overall)) : 0;
    const cost = run.iterations.reduce((sum, turn) => sum + turn.costUsd, 0);
    return [run.runId, run.status, run.iterations.length, best.toFixed(3), formatUsd(cost), run.startedAt].join("\t");
  })].join("\n");
};
