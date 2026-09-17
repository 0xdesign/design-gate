import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import type { ObservationsFile, ObserveRequest } from "../types.js";
import { observationsSchemaHint, validateObservationsFile } from "./schema.js";

export function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function writeObserveRequest(
  designGateDir: string,
  request: Omit<ObserveRequest, "schemaHint" | "writeTo">,
): ObserveRequest {
  const directory = resolve(designGateDir);
  mkdirSync(directory, { recursive: true });
  const result: ObserveRequest = {
    ...request,
    screens: request.screens.map((screen) => ({
      ...screen,
      screenshotPath: isAbsolute(screen.screenshotPath)
        ? screen.screenshotPath
        : resolve(screen.screenshotPath),
    })),
    schemaHint: observationsSchemaHint(),
    writeTo: resolve(directory, "observations.json"),
  };
  writeFileSync(resolve(directory, "observe-request.json"), `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

export function readObservations(
  designGateDir: string,
  runId: string,
  turn: number,
):
  | { file: ObservationsFile; sha256: string }
  | { missing: true }
  | { stale: true; reason: string }
  | { invalid: true; errors: string[] } {
  const path = resolve(designGateDir, "observations.json");
  if (!existsSync(path)) return { missing: true };

  let text: string;
  let raw: unknown;
  try {
    text = readFileSync(path, "utf8");
    raw = JSON.parse(text);
  } catch (error) {
    return { invalid: true, errors: [error instanceof Error ? error.message : String(error)] };
  }

  const validated = validateObservationsFile(raw);
  if (!validated.ok) return { invalid: true, errors: validated.errors };
  if (validated.value.runId !== runId || validated.value.turn !== turn) {
    return {
      stale: true,
      reason: `expected runId ${runId} turn ${turn}; found runId ${validated.value.runId} turn ${validated.value.turn}`,
    };
  }
  return { file: validated.value, sha256: sha256Of(text) };
}
