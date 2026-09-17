import { TypeSafeClient, type EntryType, type Questions } from "@typesafe-ai/sdk";

import type { JevState, Judge, JudgeResult, Question } from "../types.js";
import { questionToJev } from "./bank.js";
import { toResult, type JevAnswer } from "./index.js";

export interface JevJudgeOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof fetch;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export class JevJudge implements Judge {
  readonly name = "jev";
  private readonly client: TypeSafeClient;
  private readonly model: string;

  constructor(options: JevJudgeOptions) {
    this.model = options.model ?? "jev-latest";
    this.client = new TypeSafeClient({
      apiKey: options.apiKey,
      defaultModel: this.model,
      timeout: options.timeoutMs,
      fetch: options.fetch,
      retry: {
        maxRetries: Math.min(3, Math.max(0, options.maxRetries ?? 3)),
        backoffInitialMs: 500,
        backoffMaxMs: 2_000,
        backoffJitter: 0,
        httpStatuses: new Set([429, ...Array.from({ length: 100 }, (_, index) => 500 + index)]),
        respectRetryAfter: false,
        apiConnectionError: false,
        apiTimeoutError: false,
      },
    });
  }

  async judge(state: JevState, questions: Question[]): Promise<JudgeResult> {
    const started = performance.now();
    const screenKey = `${state.brief.route}|${state.brief.viewport}`;
    if (questions.length === 0) {
      return { screenKey, model: this.model, results: [], latencyMs: 0, stateSent: state };
    }

    try {
      const requestQuestions = Object.fromEntries(
        questions.map((question) => [question.id, questionToJev(question)]),
      ) as Questions;
      const response = await this.client.systemOne({
        state: state as unknown as EntryType,
        questions: requestQuestions,
        model: this.model,
      });
      const answers = response.answers as Record<string, JevAnswer | undefined>;
      const results = questions.map((question) => {
        const answer = answers[question.id];
        if (!answer) throw new Error(`Jev returned no answer for question ${question.id}`);
        return toResult(question, answer);
      });
      if (Object.keys(answers).length !== questions.length) {
        throw new Error(`Jev returned ${Object.keys(answers).length} answers for ${questions.length} questions`);
      }
      return {
        screenKey,
        model: response.model,
        results,
        usage: response.usage,
        latencyMs: Math.round(performance.now() - started),
        stateSent: state,
      };
    } catch (error) {
      return {
        screenKey,
        model: this.model,
        results: [],
        latencyMs: Math.round(performance.now() - started),
        error: errorMessage(error),
        stateSent: state,
      };
    }
  }
}
