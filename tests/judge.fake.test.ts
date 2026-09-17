import { describe, expect, it } from "vitest";

import { loadBank } from "../src/judge/bank.js";
import { FakeJudge } from "../src/judge/fake.js";
import type { JevState } from "../src/types.js";
import { join } from "node:path";

function state(generic: boolean): JevState {
  return {
    brief: { route: "/", viewport: "desktop", screen_type: "landing" },
    brand: {
      name: "Acme",
      intent: "conventional",
      palette: [{ token: "ink", hex: "#111111" }],
      type: [{ family: "Inter" }],
      radius: { scale: [] }, spacing: { base: 4, scale: [] },
      voice: [], forbidden: ["synergy"], darkMode: false, sources: [],
    },
    facts: {
      screen: { route: "/", viewport: "desktop" },
      color: { palette_size: "4-6", off_token_share: generic ? "most" : "none", off_token_examples: [], contrast_fails: "0" },
      type: { families: ["Inter"], off_brand_families: generic ? ["Arial"] : [], distinct_sizes: "1-4", scale_is_regular: true, min_body_px: "16+", longest_line_chars: "45-75" },
      space: { grid_px: 4, off_grid_share: generic ? "most" : "none", distinct_gaps: "1-4" },
      shape: { radii_distinct: "1", shadows_distinct: "1" },
      a11y: { small_targets: "0", focus_visible_missing: false, axe_serious: "0", heading_outline: "ok", landmarks: ["main"] },
      motion: { durations: "none", reduced_motion_respected: true },
      density: { ctas_above_fold: "1", above_fold: "moderate", horizontal_overflow: false },
    },
    observations: {
      screen_type: "landing", focal_point: generic ? "none_clear" : "headline", hierarchy_levels: "3",
      reading_order: "clear", status_encoding: "na", patterns_present: ["hero"],
      generic_traits: generic ? ["saas_card_kit", "gradient_blob"] : [],
      copy: { headline: "Build better", primary_cta: generic ? "Get started" : "Create a workspace", empty_state: "" },
      mood: generic ? ["generic"] : ["quiet"],
    },
  };
}

describe("FakeJudge", () => {
  it("is deterministic and distinguishes generic from on-brand states", async () => {
    const bank = loadBank(join(import.meta.dirname, "fixtures", "bank.sample.yaml"));
    const judge = new FakeJudge();
    const generic = await judge.judge(state(true), bank.questions);
    const repeated = await judge.judge(state(true), bank.questions);
    const onBrand = await judge.judge(state(false), bank.questions);
    expect(repeated.results).toEqual(generic.results);
    expect(generic.results.find((result) => result.id === "pattern.anti_generic")?.probability).toBe(0.75);
    expect(onBrand.results.find((result) => result.id === "pattern.anti_generic")?.probability).toBe(0.15);
    expect(generic.results.find((result) => result.id === "brand.palette_fit")?.probability).toBe(0.1);
    expect(onBrand.results.find((result) => result.id === "brand.palette_fit")?.probability).toBe(0.95);
  });
});
