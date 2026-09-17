import { readFile } from "node:fs/promises";

import {
  FOCAL_POINTS,
  GENERIC_TRAITS,
  MOODS,
  ObservationsSchema,
  SCREEN_TYPES,
  UI_PATTERNS,
  type Observations,
} from "../types.js";
import { observationsJsonSchema } from "./schema.js";

const PROMPT = `Describe only what is visibly present in this rendered UI screenshot.
Return the requested JSON object and nothing else. Do not judge quality, infer implementation,
or recommend fixes. Use only these closed vocabularies:
- screen_type: ${SCREEN_TYPES.join(", ")}
- focal_point: ${FOCAL_POINTS.join(", ")}
- generic_traits: ${GENERIC_TRAITS.join(", ")}
- patterns_present: ${UI_PATTERNS.join(", ")}
- mood: ${MOODS.join(", ")}
Transcribe visible copy exactly. Use empty strings for absent copy and include only traits and
patterns that are actually visible.`;

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function observeWithClaude(args: {
  screenshotPath: string;
  route: string;
  viewport: string;
  model: string;
  apiKey?: string;
}): Promise<
  | { ok: true; observations: Observations; usage: { input_tokens: number; output_tokens: number } }
  | { ok: false; reason: string }
> {
  const mod = await import("@anthropic-ai/sdk").catch(() => null);
  if (mod === null) return { ok: false, reason: "@anthropic-ai/sdk not installed" };

  try {
    const data = (await readFile(args.screenshotPath)).toString("base64");
    const client = new mod.Anthropic(args.apiKey ? { apiKey: args.apiKey } : {});
    const message = await client.messages.create({
      model: args.model,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data } },
            {
              type: "text",
              text: `${PROMPT}\nContext only: route=${args.route}; viewport=${args.viewport}.`,
            },
          ],
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: observationsJsonSchema() as Record<string, unknown>,
        },
      },
    });
    const text = message.content.find((block) => block.type === "text")?.text;
    if (!text) return { ok: false, reason: "Claude returned no JSON text block" };
    const parsed = ObservationsSchema.safeParse(JSON.parse(text));
    if (!parsed.success) {
      return {
        ok: false,
        reason: `Claude observations failed validation: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
          .join("; ")}`,
      };
    }
    return {
      ok: true,
      observations: parsed.data,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
      },
    };
  } catch (error) {
    return { ok: false, reason: errorReason(error) };
  }
}
