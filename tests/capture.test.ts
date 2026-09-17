import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { captureScreen } from "../src/capture/playwright.js";
import { fixturePath, mobile } from "./helpers.js";

describe("captureScreen", () => {
  let outDir: string;

  beforeAll(async () => {
    outDir = await mkdtemp(join(tmpdir(), "design-gate-capture-"));
  });

  afterAll(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("captures a stable mobile DOM snapshot and screenshot", async () => {
    const snapshot = await captureScreen({
      url: pathToFileURL(fixturePath("generic-saas", "index.html")).href,
      route: "/index",
      viewport: mobile,
      outDir,
      shotName: "generic-mobile",
    });

    expect(snapshot.elements.length).toBeGreaterThan(20);
    await expect(stat(snapshot.screenshotPath)).resolves.toMatchObject({ size: expect.any(Number) });
    const hash = createHash("sha256").update(await readFile(snapshot.screenshotPath)).digest("hex");
    expect(snapshot.screenshotSha256).toBe(hash);
    expect(Array.isArray(snapshot.axe)).toBe(true);
    expect(snapshot.headings.some((heading) => heading.level === 1)).toBe(true);
  });
});
