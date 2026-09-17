import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { startStaticServer } from "../src/capture/static-server.js";
import { runCheck } from "../src/cli/check.js";
import { explainQuestion } from "../src/cli/commands/explain.js";
import { compileCrossScreen, compileScreen, deterministicGates } from "../src/facts/index.js";
import { fileHashes, listUiFiles, uiHash } from "../src/run/hash.js";
import { openOrCreateRun } from "../src/run/store.js";
import { BrandSchema } from "../src/types.js";
import { captureFixtureScreens } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

describe("explain", () => {
  it("shows the question, fix, result, and requested fact values", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const cwd = mkdtempSync(join(tmpdir(), "design-gate-explain-"));
    const home = mkdtempSync(join(tmpdir(), "design-gate-home-"));
    cpSync(resolve(process.cwd(), "fixtures", "generic-saas"), cwd, { recursive: true });
    let restricted = false;
    const server = await startStaticServer(cwd).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("EPERM")) throw error;
      restricted = true;
      return { url: pathToFileURL(join(cwd, "index.html")).href, port: 0, stop: async () => undefined };
    });
    try {
      writeFileSync(join(cwd, "design-gate.yml"), JSON.stringify({
        version: 1,
        devServer: { url: server.url, autoStart: false },
        routes: ["/"],
        uiGlobs: ["**/*.html"],
        brandFile: "brand.json",
        judge: "fake",
        observer: "none",
      }));
      if (restricted) {
        const opened = openOrCreateRun(cwd, { configHash: "test", brandHash: "test", bankHash: "test", keyPresent: false });
        const brand = BrandSchema.parse(JSON.parse(readFileSync(join(cwd, "brand.json"), "utf8")) as unknown);
        const screens = (await captureFixtureScreens("generic-saas", join(opened.runDir, "shots")))
          .map((snapshot) => compileScreen(snapshot, brand));
        const crossScreen = compileCrossScreen(screens);
        const hashes = fileHashes(cwd, listUiFiles(cwd, ["**/*.html"]));
        writeFileSync(join(opened.runDir, "pending-1.json"), JSON.stringify({
          hash: uiHash(hashes), screens, crossScreen,
          hardFailures: deterministicGates(screens, crossScreen, brand),
        }));
      }
      await runCheck({ cwd, home, env: {}, mode: "check", json: true });
      const output = explainQuestion("brand.palette_fit", undefined, cwd);
      expect(output).toContain("Answer true if the screen's colors come from the brand palette");
      expect(output).toContain("Replace the hard-coded colors");
      expect(output).toContain('"color"');
      expect(output).toContain('"off_token_share"');
    } finally {
      await server.stop();
    }
  });
});
