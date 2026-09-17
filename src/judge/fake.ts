import type {
  ChoiceResponse,
  NoulResponse,
  ScoreResponse,
} from "@typesafe-ai/sdk";

import type { JevState, Judge, JudgeResult, Question } from "../types.js";
import { toResult, type JevAnswer } from "./index.js";

const SHARE_PROBABILITY = { none: 0.95, few: 0.75, some: 0.35, most: 0.1 } as const;

function scoreLevels(question: Question): number {
  return Array.isArray(question.criteria) && question.criteria.length >= 2
    ? question.criteria.length
    : 2;
}

function noulAnswer(probability: number): NoulResponse {
  return { type: "noul", noul: probability };
}

function scoreAnswer(question: Question, score: number, confidence = 0.9): ScoreResponse {
  const levels = scoreLevels(question);
  const bounded = Math.max(0, Math.min(levels - 1, score));
  return {
    type: "score",
    score: bounded,
    confidence,
    legend: Object.fromEntries(Array.from({ length: levels }, (_, index) => [index, null])),
    probabilities: Object.fromEntries(
      Array.from({ length: levels }, (_, index) => [index, index === Math.round(bounded) ? 1 : 0]),
    ),
  } as unknown as ScoreResponse;
}

function choiceAnswer(question: Question): ChoiceResponse {
  const labels = question.criteria && typeof question.criteria === "object" && !Array.isArray(question.criteria)
    ? Object.keys(question.criteria)
    : [];
  const choice = question.pass_choices.find((entry) => labels.includes(entry))
    ?? (labels.includes("none") ? "none" : labels[0] ?? "none");
  const remainder = labels.length > 1 ? 0.2 / (labels.length - 1) : 0;
  const probabilities = Object.fromEntries(labels.map((label) => [label, label === choice ? 0.8 : remainder]));
  if (!(choice in probabilities)) probabilities[choice] = 0.8;
  return { type: "choice", choice, confidence: 0.8, probabilities };
}

function copyContainsForbidden(state: JevState): boolean {
  const text = Object.values(state.observations?.copy ?? {}).join(" ").toLocaleLowerCase();
  return state.brand.forbidden.some((word) => text.includes(word.toLocaleLowerCase()));
}

function answerFor(question: Question, state: JevState): JevAnswer {
  if (question.type === "choice") return choiceAnswer(question);

  const id = question.id.toLocaleLowerCase();
  if (question.type === "score") {
    const top = scoreLevels(question) - 1;
    if (id.includes("hierarchy")) {
      const focal = state.observations?.focal_point;
      const ctas = state.facts.density.ctas_above_fold;
      return scoreAnswer(question, focal !== undefined && focal !== "none_clear" && (ctas === "1" || ctas === "2") ? top : 0);
    }
    if (id.includes("copy") || id.includes("cta")) {
      const cta = state.observations?.copy.primary_cta ?? "";
      return scoreAnswer(question, /^(submit|continue|learn more|get started)/i.test(cta) ? 0 : top);
    }
    return scoreAnswer(question, top, 0.7);
  }

  if (id.includes("anti_generic")) {
    const count = state.observations?.generic_traits.length ?? 0;
    return noulAnswer(Math.min(0.95, 0.15 + 0.3 * count));
  }
  if (id.includes("palette_fit") || id.includes("brand.color")) {
    return noulAnswer(SHARE_PROBABILITY[state.facts.color.off_token_share]);
  }
  if (id.includes("type") || id.includes("font")) {
    return noulAnswer(state.facts.type.off_brand_families.length === 0 ? 0.9 : 0.1);
  }
  if (id.includes("spacing")) {
    return noulAnswer(SHARE_PROBABILITY[state.facts.space.off_grid_share]);
  }
  if (id.includes("forbidden") || id.includes("voice")) {
    return noulAnswer(copyContainsForbidden(state) ? 0.95 : 0.05);
  }
  if (id.includes("color_only")) {
    return noulAnswer(state.observations?.status_encoding === "color_only" ? 0.9 : 0.05);
  }
  if (id.includes("card_abuse")) {
    const traits = state.observations?.generic_traits ?? [];
    const cardy = traits.includes("saas_card_kit") || traits.includes("three_col_features");
    return noulAnswer(cardy && state.facts.shape.radii_distinct === "1" ? 0.9 : 0.1);
  }
  if (id.includes("eyebrow")) {
    const traits: string[] = state.observations?.generic_traits ?? [];
    const decorative = ["allcaps_eyebrow", "numbered_steps_decoration", "middle_dot_meta", "single_word_accent_headline"];
    return noulAnswer(traits.some((trait) => decorative.includes(trait)) ? 0.9 : 0.1);
  }
  if (id.includes("case_and_length")) {
    const headline = state.observations?.copy.headline ?? "";
    const cta = state.observations?.copy.primary_cta ?? "";
    const allCaps = (text: string): boolean => text.length > 3 && text === text.toUpperCase() && /[A-Z]/.test(text);
    const words = (text: string): number => text.split(/\s+/).filter(Boolean).length;
    return noulAnswer(allCaps(headline) || allCaps(cta) || words(cta) > 5 || words(headline) > 14 ? 0.9 : 0.1);
  }
  return noulAnswer(question.bad_if_true ? 0.1 : 0.8);
}

export class FakeJudge implements Judge {
  readonly name = "fake";

  async judge(state: JevState, questions: Question[]): Promise<JudgeResult> {
    return {
      screenKey: `${state.brief.route}|${state.brief.viewport}`,
      model: "fake",
      results: questions.map((question) => toResult(question, answerFor(question, state))),
      usage: { input_tokens: 0, output_tokens: 0 },
      latencyMs: 0,
      stateSent: state,
    };
  }
}
