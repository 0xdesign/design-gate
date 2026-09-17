import { isAbsolute, relative, resolve, sep } from "node:path";

import type { Category, Decision, GateFailure, TurnRecord, Verdict } from "../types.js";

export interface CheckJson {
  verdict: Verdict;
  reason?: string;
  runId: string;
  turn: number;
  overall: number;
  best: number;
  categories: Record<Category, number>;
  fixes: Decision["fixes"];
  hardFailures: Array<Pick<GateFailure, "id" | "measured" | "selectors" | "fix">>;
  notes: string[];
  observeRequest: string | null;
  runPage: string;
  screenshots: { key: string; path: string }[];
  cost: { usd: number; inputTokens: number };
  cacheHit: boolean;
}

const relativePath = (cwd: string, path: string): string => {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path);
  return relative(resolve(cwd), absolute).split(sep).join("/");
};

const emptyCategories = (): CheckJson["categories"] => ({
  brand: 0,
  craft: 0,
  ux: 0,
  a11y: 0,
  pattern: 0,
  copy: 0,
});

export const buildCheckJson = (args: {
  cwd: string;
  runId: string;
  turn: number;
  runPage: string;
  verdict?: Verdict;
  reason?: string;
  decision?: Decision;
  notes?: string[];
  observeRequest?: string | null;
  screenshots?: { key: string; path: string }[];
  usage?: Pick<TurnRecord["usage"], "costUsd" | "inputTokens">;
  cacheHit?: boolean;
}): CheckJson => {
  const verdict = args.decision?.verdict ?? args.verdict ?? "SKIPPED";
  const reason = args.decision?.reason ?? args.reason;
  const hardFailures = (args.decision?.hardFailures ?? []).map(({ id, measured, selectors, fix }) => ({
    id,
    measured,
    selectors,
    fix,
  }));
  return {
    verdict,
    ...(reason === undefined ? {} : { reason }),
    runId: args.runId,
    turn: args.turn,
    overall: args.decision?.overall ?? 0,
    best: args.decision?.best ?? 0,
    categories: args.decision?.categories ?? emptyCategories(),
    fixes: args.decision?.fixes ?? [],
    hardFailures,
    notes: args.notes ?? [],
    observeRequest: args.observeRequest ? relativePath(args.cwd, args.observeRequest) : null,
    runPage: relativePath(args.cwd, args.runPage),
    screenshots: (args.screenshots ?? []).map((shot) => ({
      key: shot.key,
      path: relativePath(args.cwd, shot.path),
    })),
    cost: { usd: args.usage?.costUsd ?? 0, inputTokens: args.usage?.inputTokens ?? 0 },
    cacheHit: args.cacheHit ?? false,
  };
};
