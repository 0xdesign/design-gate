import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  applicableQuestions,
  bankHash,
  loadBank,
  questionToJev,
} from "../src/judge/bank.js";

const fixture = join(import.meta.dirname, "fixtures", "bank.sample.yaml");

describe("question bank", () => {
  it("loads, defaults, and hashes canonically", () => {
    const bank = loadBank(fixture);
    expect(bank.questions).toHaveLength(8);
    expect(bankHash(bank)).toMatch(/^[a-f0-9]{64}$/);
    expect(bankHash({ ...bank, questions: [...bank.questions] })).toBe(bankHash(bank));
  });

  it("filters by intent and required context", () => {
    const bank = loadBank(fixture);
    const withoutContext = applicableQuestions(bank, {
      intent: "brutalist",
      hasObservations: false,
      hasBrand: false,
    });
    expect(withoutContext.map((question) => question.id)).toEqual([
      "craft.spacing",
      "craft.hidden_consistency",
    ]);
    const all = applicableQuestions(bank, {
      intent: "conventional",
      hasObservations: true,
      hasBrand: true,
    });
    expect(all).toHaveLength(8);
  });

  it("maps every question type to the SDK shape", () => {
    const bank = loadBank(fixture);
    expect(questionToJev(bank.questions[0]!)).toMatchObject({ type: "noul" });
    expect(questionToJev(bank.questions[4]!)).toEqual({
      type: "score",
      instructions: "Rate the visible hierarchy.",
      criteria: [
        "No discernible hierarchy.",
        "Some hierarchy but competing focal points.",
        "One clear focal point and supporting levels.",
      ],
    });
    expect(questionToJev(bank.questions[6]!)).toMatchObject({
      type: "choice",
      criteria: { none: "No pattern problem." },
    });
  });
});
