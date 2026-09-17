import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brand, ScreenAnalysis } from "../src/types.js";
import { compileCrossScreen, compileScreen, deterministicGates } from "../src/facts/index.js";
import { captureFixtureScreens, loadBrand } from "./helpers.js";

describe("generic SaaS facts", () => {
  let outDir: string;
  let brand: Brand;
  let screens: ScreenAnalysis[];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "design-gate-generic-"));
    brand = await loadBrand("generic-saas");
    screens = (await captureFixtureScreens("generic-saas", outDir)).map((snapshot) => compileScreen(snapshot, brand));
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("records the intended deterministic failures", () => {
    for (const screen of screens) {
      expect(["some", "most"]).toContain(screen.facts.color.off_token_share);
      expect(screen.facts.color.contrast_fails).not.toBe("0");
      expect(screen.facts.type.off_brand_families.length).toBeGreaterThan(0);
      expect(screen.facts.space.off_grid_share).not.toBe("none");
      expect(screen.facts.a11y.focus_visible_missing).toBe(true);
      expect(screen.facts.a11y.heading_outline).toBe("skips_level");
      expect(screen.facts.motion.durations).not.toBe("none");
      expect(screen.facts.motion.reduced_motion_respected).toBe(false);
    }
    for (const screen of screens.filter((candidate) => candidate.snapshot.viewport.name === "mobile")) {
      expect(screen.facts.a11y.small_targets).not.toBe("0");
    }
  });

  it("finds cross-screen drift and emits the required gates", () => {
    const cross = compileCrossScreen(screens);
    expect(["2-3", "4+"]).toContain(cross.button_signatures);
    const ids = new Set(deterministicGates(screens, cross, brand).map((failure) => failure.id));
    for (const id of ["det.contrast", "det.small_targets", "det.focus_visible", "det.heading_outline", "det.viewport_scale_lock"]) {
      expect(ids.has(id)).toBe(true);
    }
  });
});
