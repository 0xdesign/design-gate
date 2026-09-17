import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { describe, expect, it } from "vitest";

import { readObservations, sha256Of, writeObserveRequest } from "../src/observe/agent.js";
import { observationsJsonSchema, observationsSchemaHint } from "../src/observe/schema.js";
import { GENERIC_TRAITS, SCREEN_TYPES } from "../src/types.js";

const observations = {
  screen_type: "landing",
  focal_point: "headline",
  hierarchy_levels: "3",
  reading_order: "clear",
  status_encoding: "na",
  patterns_present: ["hero"],
  generic_traits: [],
  copy: { headline: "Hello", primary_cta: "Try it", empty_state: "" },
  mood: ["quiet"],
} as const;

describe("observation exchange", () => {
  it("exposes every closed vocabulary and a strict generated JSON schema", () => {
    const hint = observationsSchemaHint();
    expect(hint.screen_type).toMatchObject({ values: [...SCREEN_TYPES] });
    expect(hint.generic_traits).toMatchObject({ values: [...GENERIC_TRAITS] });
    const schema = observationsJsonSchema() as Record<string, unknown>;
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
  });

  it("writes a request and reads valid observations with provenance", () => {
    const directory = mkdtempSync(join(tmpdir(), "design-gate-observe-"));
    const request = writeObserveRequest(directory, {
      runId: "run-1", turn: 2,
      screens: [{ key: "/|desktop", route: "/", viewport: "desktop", screenshotPath: "shot.png" }],
    });
    expect(isAbsolute(request.screens[0]!.screenshotPath)).toBe(true);
    expect(request.writeTo).toBe(join(directory, "observations.json"));
    const text = `${JSON.stringify({ runId: "run-1", turn: 2, author: "agent", screens: { "/|desktop": observations } }, null, 2)}\n`;
    writeFileSync(request.writeTo, text);
    expect(readObservations(directory, "run-1", 2)).toMatchObject({
      file: { runId: "run-1", turn: 2 }, sha256: sha256Of(text),
    });
  });

  it("distinguishes stale and invalid files", () => {
    const directory = mkdtempSync(join(tmpdir(), "design-gate-observe-"));
    const path = join(directory, "observations.json");
    writeFileSync(path, JSON.stringify({ runId: "old", turn: 1, author: "agent", screens: { "/|desktop": observations } }));
    expect(readObservations(directory, "new", 2)).toMatchObject({ stale: true });
    writeFileSync(path, JSON.stringify({ runId: "new", turn: 2, author: "agent", screens: { "/|desktop": { ...observations, screen_type: "website" } } }));
    expect(readObservations(directory, "new", 2)).toMatchObject({ invalid: true });
  });
});
