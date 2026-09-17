import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Brand, ScreenAnalysis } from "../src/types.js";
import { compileCrossScreen, compileScreen, deterministicGates } from "../src/facts/index.js";
import { captureFixtureScreens, loadBrand } from "./helpers.js";

describe("on-brand facts", () => {
  let outDir: string;
  let brand: Brand;
  let screens: ScreenAnalysis[];

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "design-gate-onbrand-"));
    brand = await loadBrand("on-brand");
    screens = (await captureFixtureScreens("on-brand", outDir)).map((snapshot) => compileScreen(snapshot, brand));
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("stays within the clean deterministic envelope", () => {
    for (const screen of screens) {
      expect(screen.facts.color.off_token_share).toBe("none");
      expect(screen.facts.color.contrast_fails).toBe("0");
      expect(screen.facts.a11y.focus_visible_missing).toBe(false);
      expect(screen.facts.a11y.heading_outline).toBe("ok");
      expect(screen.facts.motion.reduced_motion_respected).toBe(true);
    }
    const cross = compileCrossScreen(screens);
    expect(deterministicGates(screens, cross, brand)).toEqual([]);
  });
});
