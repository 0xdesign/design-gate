import { describe, expect, it } from "vitest";

import { decide } from "../src/decide/decide.js";
import type { Decision, GateFailure, JudgeResult, Question, QuestionResult } from "../src/types.js";

const thresholds = { approve: 0.8, categoryFloor: 0.6, confidenceMin: 0.5, maxIterations: 5, epsilon: 0.02, maxFixes: 6 };
const categoryWeights = { brand: 0.25, craft: 0.25, ux: 0.2, a11y: 0.15, pattern: 0.1, copy: 0.05 };

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "craft.quality", category: "craft", type: "noul", weight: 1, gate: false, hidden: false,
    threshold: 0.6, applies_to: ["conventional"], needs: ["facts"], instructions: "Good?",
    bad_if_true: false, pass_choices: [], fix: "Improve it.", refs: [], ...overrides,
  };
}

function result(q: Question, probability: number, confidence = 0.9, passed = probability >= q.threshold): QuestionResult {
  return {
    id: q.id, type: q.type, probability, confidence, raw: {}, passed, gate: q.gate,
    hidden: q.hidden, weight: q.weight, category: q.category, threshold: q.threshold, fix: q.fix,
  };
}

function judge(q: Question, probability: number, confidence = 0.9, passed?: boolean): JudgeResult {
  return {
    screenKey: "/|desktop", model: "fake", results: [result(q, probability, confidence, passed)],
    latencyMs: 0, stateSent: {} as JudgeResult["stateSent"],
  };
}

function previousDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    verdict: "REVISE", overall: 0.5, best: 0.5,
    categories: { brand: 0, craft: 0.5, ux: 0, a11y: 0, pattern: 0, copy: 0 },
    hardFailures: [], gateFailures: [], uncertain: [], fixes: [], suppressed: [], signature: "",
    ...overrides,
  };
}

function run(args: Partial<Parameters<typeof decide>[0]> = {}): Decision {
  const q = args.questions?.[0] ?? question();
  return decide({
    turn: 1, screens: [{ key: "/|desktop", judge: judge(q, 0.9) }], hardFailures: [],
    questions: [q], previous: [], thresholds, categoryWeights, waivers: [], keyPresent: true,
    ...args,
  });
}

describe("decide", () => {
  it("approves a confident high-scoring result", () => {
    expect(run().verdict).toBe("APPROVED");
  });

  it("carries the best score recorded by prior decisions", () => {
    const prior = previousDecision({ overall: 0.5, best: 0.92 });
    expect(run({ previous: [{ decision: prior, fixesSent: [] }] }).best).toBe(0.92);
  });

  it("revises with deterministic and per-screen gate fixes ranked by severity", () => {
    const q = question({ id: "brand.palette", category: "brand", gate: true, weight: 2 });
    const hard: GateFailure = { id: "det.contrast", category: "a11y", measured: "3:1", selectors: [".muted"], fix: "Raise contrast.", weight: 3 };
    const decision = run({ questions: [q], screens: [{ key: "/|desktop", judge: judge(q, 0.2, 0.9, false) }], hardFailures: [hard] });
    expect(decision.verdict).toBe("REVISE");
    expect(decision.fixes.map((fix) => [fix.id, fix.screen])).toEqual([
      ["det.contrast", undefined], ["brand.palette", "/|desktop"],
    ]);
  });

  it("escalates repeated uncertainty", () => {
    const q = question({ gate: true });
    const prior = previousDecision({ uncertain: [q.id] });
    expect(run({ questions: [q], screens: [{ key: "/|desktop", judge: judge(q, 0.7, 0.2) }], previous: [{ decision: prior, fixesSent: [] }] }).verdict).toBe("ESCALATE");
  });

  it("stops at max iterations and on a repeated nonempty failure signature", () => {
    const q = question({ gate: true });
    expect(run({ turn: 5, questions: [q], screens: [{ key: "/|desktop", judge: judge(q, 0.2, 0.9, false) }] }).verdict).toBe("STOP");
    const prior = previousDecision({ signature: q.id, gateFailures: [q.id] });
    expect(run({ questions: [q], screens: [{ key: "/|desktop", judge: judge(q, 0.2, 0.9, false) }], previous: [{ decision: prior, fixesSent: [] }] }).reason).toContain("signature");
  });

  it("stops after two turns below the prior best", () => {
    const best = previousDecision({ overall: 0.9, best: 0.9 });
    const regressed = previousDecision({ overall: 0.6, best: 0.9 });
    const decision = run({
      turn: 3,
      screens: [{ key: "/|desktop", judge: judge(question(), 0.5, 0.9, false) }],
      previous: [{ decision: best, fixesSent: [] }, { decision: regressed, fixesSent: [] }],
    });
    expect(decision.verdict).toBe("STOP");
    expect(decision.reason).toContain("regressed");
  });

  it("suppresses a fix sent twice without epsilon improvement", () => {
    const q = question();
    const oldFix = { id: q.id, text: q.fix!, selectors: [], screen: "/|desktop", rank: 0.8, source: "composite" as const };
    const old = previousDecision({ fixes: [oldFix] });
    const decision = run({
      questions: [q], screens: [{ key: "/|desktop", judge: judge(q, 0.21, 0.9, false) }],
      previous: [{ decision: old, fixesSent: [q.id] }, { decision: old, fixesSent: [q.id] }],
    });
    expect(decision.suppressed).toEqual([q.id]);
    expect(decision.fixes).toEqual([]);
  });

  it("keeps waived questions in the composite but removes their gates and fixes", () => {
    const q = question({ gate: true });
    const decision = run({ questions: [q], screens: [{ key: "/|desktop", judge: judge(q, 0.2, 0.9, false) }], waivers: [q.id] });
    expect(decision.overall).toBe(0.2);
    expect(decision.gateFailures).toEqual([]);
    expect(decision.fixes).toEqual([]);
  });

  it("uses deterministic gates only in facts-only mode", () => {
    const approved = run({ keyPresent: false, screens: [] });
    expect(approved).toMatchObject({ verdict: "APPROVED", reason: "facts-only (KEY NEEDED)", overall: 0 });
    const hard: GateFailure = { id: "det.axe", category: "a11y", measured: "1 serious", selectors: [], fix: "Fix axe violation.", weight: 1 };
    expect(run({ keyPresent: false, screens: [], hardFailures: [hard] }).verdict).toBe("REVISE");
  });
});
