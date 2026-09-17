import { spawn } from "node:child_process";
import { createRequire } from "node:module";

import { chromium } from "playwright";

export const MISSING_BROWSER_HINT =
  "Chromium for screenshots is not installed. Run `npx design-gate init` once (or `npx playwright install chromium`).";

export const isMissingBrowserError = (message: string): boolean =>
  /Executable doesn't exist|playwright install/i.test(message);

/** "ok" when Chromium launches, "missing" when the executable is absent, "error" for any other launch failure. */
export async function browserStatus(): Promise<"ok" | "missing" | "error"> {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return "ok";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return isMissingBrowserError(message) ? "missing" : "error";
  }
}

export async function installBrowser(log: (message: string) => void): Promise<boolean> {
  const require = createRequire(import.meta.url);
  const cli = require.resolve("playwright/cli.js");
  log("Downloading Chromium for screenshots (one-time, about 100 MB)...");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, "install", "chromium"], { stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
  });
}

export async function ensureBrowser(log: (message: string) => void): Promise<"ok" | "installed" | "failed" | "unknown"> {
  const status = await browserStatus();
  if (status === "ok") return "ok";
  if (status === "error") return "unknown";
  return (await installBrowser(log)) ? "installed" : "failed";
}
