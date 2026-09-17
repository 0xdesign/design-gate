import type {
  ChoiceResponse,
  NoulResponse,
  ScoreResponse,
} from "@typesafe-ai/sdk";

import type { Judge, Question, QuestionResult } from "../types.js";
import { FakeJudge } from "./fake.js";
import { JevJudge, type JevJudgeOptions } from "./jev.js";

export type JevAnswer = NoulResponse | ScoreResponse | ChoiceResponse;

export function toResult(question: Question, answer: JevAnswer): QuestionResult {
  if (question.type !== answer.type) {
    throw new Error(`Answer type ${answer.type} does not match question ${question.id} (${question.type})`);
  }

  let probability: number;
  let confidence: number;
  let passed: boolean;
  let fix = question.fix;

  if (answer.type === "noul") {
    probability = answer.noul;
    confidence = Math.abs(probability - 0.5) * 2;
    passed = question.bad_if_true
      ? probability < question.threshold
      : probability >= question.threshold;
  } else if (answer.type === "score") {
    const levels = Array.isArray(question.criteria) ? question.criteria.length : 0;
    if (levels < 2) throw new Error(`Question ${question.id} has invalid score criteria`);
    probability = answer.score / (levels - 1);
    confidence = answer.confidence;
    passed = probability >= question.threshold;
  } else {
    probability = answer.probabilities[answer.choice] ?? 0;
    confidence = answer.confidence;
    passed = question.pass_choices.length === 0 || question.pass_choices.includes(answer.choice);
    fix = question.fix_by_choice?.[answer.choice] ?? fix;
  }

  return {
    id: question.id,
    type: question.type,
    probability,
    confidence,
    raw: answer,
    passed,
    gate: question.gate,
    hidden: question.hidden,
    weight: question.weight,
    category: question.category,
    threshold: question.threshold,
    ...(fix === undefined ? {} : { fix }),
  };
}

export function createJudge(kind: "jev", options: JevJudgeOptions): JevJudge;
export function createJudge(kind: "fake", options?: Partial<JevJudgeOptions>): FakeJudge;
export function createJudge(kind: "jev" | "fake", options?: JevJudgeOptions): Judge;
export function createJudge(
  kind: "jev" | "fake",
  options?: Partial<JevJudgeOptions>,
): Judge {
  if (kind === "fake") return new FakeJudge();
  if (!options || !("apiKey" in options)) throw new Error("A TypeSafe API key is required for the Jev judge");
  return new JevJudge(options as JevJudgeOptions);
}

export { loadBank, defaultBankPath, bankHash, applicableQuestions, questionToJev } from "./bank.js";
export { FakeJudge } from "./fake.js";
export { JevJudge, type JevJudgeOptions } from "./jev.js";
export { buildState } from "./state.js";
