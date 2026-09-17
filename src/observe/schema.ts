import { z } from "zod";

import {
  FOCAL_POINTS,
  GENERIC_TRAITS,
  MOODS,
  ObservationsFileSchema,
  ObservationsSchema,
  SCREEN_TYPES,
  UI_PATTERNS,
  type Observations,
  type ObservationsFile,
} from "../types.js";

export function observationsSchemaHint(): Record<string, unknown> {
  return {
    screen_type: {
      type: "enum",
      values: [...SCREEN_TYPES],
      guidance: "choose the screen's primary job from what is visibly rendered",
    },
    focal_point: {
      type: "enum",
      values: [...FOCAL_POINTS],
      guidance: "choose the first element that visually commands attention, or none_clear",
    },
    hierarchy_levels: {
      type: "enum",
      values: ["1", "2", "3", "4+"],
      guidance: "count the visibly distinct levels of emphasis in the screen",
    },
    reading_order: {
      type: "enum",
      values: ["clear", "ambiguous"],
      guidance: "report whether the visual path through the screen is immediately clear",
    },
    status_encoding: {
      type: "enum",
      values: ["color_only", "color_plus_icon", "color_plus_text", "na"],
      guidance: "describe how visible statuses communicate meaning; use na when no status appears",
    },
    patterns_present: {
      type: "array<enum>",
      values: [...UI_PATTERNS],
      maxItems: 12,
      guidance: "list every allowed UI pattern that is visibly present and no inferred patterns",
    },
    generic_traits: {
      type: "array<enum>",
      values: [...GENERIC_TRAITS],
      maxItems: 10,
      guidance: "list every stock AI-template tell you can actually see; do not omit any",
    },
    copy: {
      type: "object",
      guidance: "transcribe the visible copy exactly, using an empty string when an item is absent",
      fields: {
        headline: { type: "string", maxLength: 200, guidance: "transcribe the main visible headline" },
        primary_cta: { type: "string", maxLength: 80, guidance: "transcribe the primary visible call to action" },
        empty_state: { type: "string", maxLength: 200, guidance: "transcribe visible empty-state copy, if any" },
      },
    },
    mood: {
      type: "array<enum>",
      values: [...MOODS],
      maxItems: 3,
      guidance: "choose up to three moods supported by visible styling, not brand intent",
    },
    notes: {
      type: "string?",
      maxLength: 600,
      guidance: "optionally record only concrete visual details useful for human review",
    },
  };
}

export function observationsJsonSchema(): object {
  return z.toJSONSchema(ObservationsSchema, {
    target: "draft-2020-12",
    override: ({ jsonSchema }) => {
      if (jsonSchema.type === "object") jsonSchema.additionalProperties = false;
    },
  });
}

function issueMessage(issue: z.core.$ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "root";
  return `${path}: ${issue.message}`;
}

export function validateObservationsFile(
  raw: unknown,
): { ok: true; value: ObservationsFile } | { ok: false; errors: string[] } {
  const parsed = ObservationsFileSchema.safeParse(raw);
  if (parsed.success) {
    const invalidKeys = Object.keys(parsed.data.screens).filter((key) => !/^.+\|[^|]+$/.test(key));
    if (invalidKeys.length > 0) {
      return {
        ok: false,
        errors: invalidKeys.map((key) => `screens.${key}: expected a route|viewport key`),
      };
    }
    return { ok: true, value: parsed.data };
  }
  return { ok: false, errors: parsed.error.issues.map(issueMessage) };
}

export function stripNotes(observations: Observations): Omit<Observations, "notes"> {
  const { notes: _notes, ...withoutNotes } = observations;
  return withoutNotes;
}
