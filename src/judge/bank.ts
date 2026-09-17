import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Question as JevQuestion } from "@typesafe-ai/sdk";
import { parse } from "yaml";

import {
  BankSchema,
  type Bank,
  type Brand,
  type Question,
} from "../types.js";

type JsonObject = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as JsonObject)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function failingQuestionIds(raw: unknown, issues: readonly { path: PropertyKey[] }[]): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const questions = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  const ids = new Set<string>();
  for (const issue of issues) {
    if (issue.path[0] !== "questions" || typeof issue.path[1] !== "number") continue;
    const item = questions[issue.path[1]];
    if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
      ids.add((item as { id: string }).id);
    } else {
      ids.add(`questions[${issue.path[1]}]`);
    }
  }
  return [...ids];
}

export function loadBank(path: string): Bank {
  let raw: unknown;
  try {
    raw = parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read question bank ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = BankSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  const ids = failingQuestionIds(raw, parsed.error.issues);
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
  throw new Error(
    `Invalid question bank${ids.length > 0 ? ` (failing questions: ${ids.join(", ")})` : ""}: ${details}`,
  );
}

export function defaultBankPath(): string {
  let directory = dirname(fileURLToPath(import.meta.url));
  while (true) {
    const packagePath = join(directory, "package.json");
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
        if (pkg.name === "design-gate") return join(directory, "questions", "bank.yaml");
      } catch {
        // Keep walking: this package.json is not the design-gate package root.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) throw new Error("Could not locate the design-gate package root");
    directory = parent;
  }
}

export function bankHash(bank: Bank): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(bank))).digest("hex");
}

export function applicableQuestions(
  bank: Bank,
  context: { intent: Brand["intent"]; hasObservations: boolean; hasBrand: boolean },
): Question[] {
  return bank.questions.filter((question) => {
    if (!question.applies_to.includes(context.intent)) return false;
    if (question.needs.includes("observations") && !context.hasObservations) return false;
    if (question.needs.includes("brand") && !context.hasBrand) return false;
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function questionToJev(question: Question): JevQuestion {
  if (question.type === "noul") {
    if (question.criteria !== undefined && !isRecord(question.criteria)) {
      throw new Error(`Question ${question.id} requires object criteria for type noul`);
    }
    return {
      type: "noul",
      instructions: question.instructions,
      ...(question.criteria === undefined ? {} : { criteria: question.criteria }),
    } as JevQuestion;
  }
  if (question.type === "score") {
    if (!Array.isArray(question.criteria) || question.criteria.length < 2) {
      throw new Error(`Question ${question.id} requires at least two score criteria levels`);
    }
    return {
      type: "score",
      instructions: question.instructions,
      criteria: question.criteria,
    } as unknown as JevQuestion;
  }
  if (!isRecord(question.criteria)) {
    throw new Error(`Question ${question.id} requires choice criteria keyed by label`);
  }
  return {
    type: "choice",
    instructions: question.instructions,
    criteria: question.criteria,
  } as JevQuestion;
}
