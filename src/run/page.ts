import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { RunRecord, TurnRecord } from "../types.js";
import { readRun, readTurn } from "./store.js";

const packageRoot = (): string => {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest)) {
      try {
        const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: unknown };
        if (parsed.name === "design-gate") return directory;
      } catch {
        // Keep walking until the package root is found.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Could not locate the design-gate package root");
    directory = parent;
  }
};

const relativeShot = (runDir: string, screenshotPath: string): string => {
  const absolute = isAbsolute(screenshotPath) ? screenshotPath : resolve(runDir, screenshotPath);
  return relative(runDir, absolute).split(sep).join("/");
};

const turnsWithRelativeShots = (runDir: string): TurnRecord[] =>
  readdirSync(runDir)
    .flatMap((name) => {
      const match = name.match(/^turn-(\d+)\.json$/);
      return match?.[1] ? [Number.parseInt(match[1], 10)] : [];
    })
    .sort((left, right) => left - right)
    .map((turnNumber) => {
      const turn = readTurn(runDir, turnNumber);
      return {
        ...turn,
        screens: turn.screens.map((screen) => ({
          ...screen,
          screenshotPath: relativeShot(runDir, screen.screenshotPath),
        })),
      };
    });

export const renderRunPage = (runDir: string): string => {
  const directory = resolve(runDir);
  const run = readRun(directory);
  const turns = turnsWithRelativeShots(directory);
  const templatePath = join(packageRoot(), "templates", "run-page.html");
  const template = readFileSync(templatePath, "utf8");
  const data = JSON.stringify({ run, turns }).replaceAll("</", "<\\/");
  const refresh = run.status === "running" ? '<meta http-equiv="refresh" content="3">' : "";
  const output = template.replace("/*__DATA__*/", data).replace("<!--__REFRESH__-->", refresh);
  const outputPath = join(directory, "index.html");
  writeFileSync(outputPath, output, "utf8");
  return outputPath;
};
