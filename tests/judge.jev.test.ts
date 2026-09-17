import { describe, expect, it } from "vitest";

import { JevJudge } from "../src/judge/jev.js";
import type { JevState, Question } from "../src/types.js";

const state = {
  brief: { route: "/", viewport: "desktop" },
  brand: { name: "A", intent: "conventional", palette: [], type: [], radius: { scale: [] }, spacing: { base: 4, scale: [] }, voice: [], forbidden: [], darkMode: false, sources: [] },
  facts: {
    screen: { route: "/", viewport: "desktop" }, color: { palette_size: "1-3", off_token_share: "none", off_token_examples: [], contrast_fails: "0" },
    type: { families: [], off_brand_families: [], distinct_sizes: "1-4", scale_is_regular: true, min_body_px: "16+", longest_line_chars: "45-75" },
    space: { grid_px: 4, off_grid_share: "none", distinct_gaps: "1-4" }, shape: { radii_distinct: "1", shadows_distinct: "0" },
    a11y: { small_targets: "0", focus_visible_missing: false, axe_serious: "0", heading_outline: "ok", landmarks: [] },
    motion: { durations: "none", reduced_motion_respected: true }, density: { ctas_above_fold: "1", above_fold: "moderate", horizontal_overflow: false },
  },
} satisfies JevState;

const questions: Question[] = [
  { id: "pattern.generic", category: "pattern", type: "noul", weight: 1, gate: true, hidden: false, threshold: 0.5, applies_to: ["conventional"], needs: ["facts"], instructions: "Generic?", bad_if_true: true, pass_choices: [], refs: [] },
  { id: "craft.score", category: "craft", type: "score", weight: 1, gate: false, hidden: false, threshold: 0.5, applies_to: ["conventional"], needs: ["facts"], instructions: "Score", criteria: ["bad", "ok", "good"], bad_if_true: false, pass_choices: [], refs: [] },
  { id: "ux.choice", category: "ux", type: "choice", weight: 1, gate: true, hidden: false, threshold: 0.5, applies_to: ["conventional"], needs: ["facts"], instructions: "Choose", criteria: { none: "none", issue: "issue" }, bad_if_true: false, pass_choices: ["none"], fix_by_choice: { issue: "Fix issue" }, refs: [] },
];

function successResponse(): Response {
  return Response.json({
    model: "jev-test",
    answers: {
      "pattern.generic": { type: "noul", noul: 0.8 },
      "craft.score": { type: "score", score: 1.5, confidence: 0.7, legend: { 0: "bad", 1: "ok", 2: "good" }, probabilities: { 0: 0, 1: 0.5, 2: 0.5 } },
      "ux.choice": { type: "choice", choice: "issue", confidence: 0.9, probabilities: { none: 0.1, issue: 0.9 } },
    },
    usage: { input_tokens: 100, output_tokens: 20 },
  });
}

describe("JevJudge", () => {
  it("maps canned transport answers", async () => {
    const judge = new JevJudge({ apiKey: "test", fetch: async () => successResponse(), maxRetries: 0 });
    const result = await judge.judge(state, questions);
    expect(result.error).toBeUndefined();
    expect(result.usage).toEqual({ input_tokens: 100, output_tokens: 20 });
    expect(result.results[0]).toMatchObject({ probability: 0.8, passed: false });
    expect(result.results[0]!.confidence).toBeCloseTo(0.6);
    expect(result.results[1]).toMatchObject({ probability: 0.75, confidence: 0.7, passed: true });
    expect(result.results[2]).toMatchObject({ probability: 0.9, confidence: 0.9, passed: false, fix: "Fix issue" });
  });

  it("retries a 429 and then succeeds", async () => {
    let calls = 0;
    const judge = new JevJudge({
      apiKey: "test",
      maxRetries: 1,
      fetch: async () => {
        calls += 1;
        return calls === 1
          ? Response.json({ error: { message: "slow down" } }, { status: 429 })
          : successResponse();
      },
    });
    expect((await judge.judge(state, questions)).error).toBeUndefined();
    expect(calls).toBe(2);
  });

  it("returns an error instead of throwing on persistent server failure", async () => {
    const judge = new JevJudge({
      apiKey: "test",
      maxRetries: 0,
      fetch: async () => Response.json({ error: { message: "broken" } }, { status: 500 }),
    });
    const result = await judge.judge(state, questions);
    expect(result.results).toEqual([]);
    expect(result.error).toContain("500");
  });
});
