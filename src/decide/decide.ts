import {
  CATEGORIES,
  type Category,
  type Config,
  type Decision,
  type Fix,
  type GateFailure,
  type JudgeResult,
  type Question,
  type QuestionResult,
} from "../types.js";

interface ScreenResult {
  screen: string;
  result: QuestionResult;
}

interface Aggregate {
  question: Question;
  screen: string;
  result: QuestionResult;
  quality: number;
}

function quality(question: Question, result: QuestionResult): number {
  return question.type === "noul" && question.bad_if_true
    ? 1 - result.probability
    : result.probability;
}

function failureRank(question: Question, result: QuestionResult): number {
  const badness = question.type === "noul" && question.bad_if_true
    ? result.probability
    : 1 - result.probability;
  return question.weight * Math.max(0, Math.min(1, badness));
}

function fixText(question: Question, result: QuestionResult): string {
  if (result.fix) return result.fix;
  if (question.fix) return question.fix;
  return typeof question.instructions === "string"
    ? question.instructions
    : `Address ${question.id}`;
}

function emptyCategories(): Record<Category, number> {
  return Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<Category, number>;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function priorQuality(fix: Fix, question: Question | undefined): number {
  if (!question || fix.source === "deterministic" || question.weight <= 0) return 0;
  const badness = Math.max(0, Math.min(1, fix.rank / question.weight));
  return 1 - badness;
}

export function decide(input: {
  turn: number;
  screens: { key: string; judge?: JudgeResult }[];
  hardFailures: GateFailure[];
  questions: Question[];
  previous: { decision: Decision; fixesSent: string[] }[];
  thresholds: Config["thresholds"];
  categoryWeights: Config["categoryWeights"];
  waivers: string[];
  keyPresent: boolean;
}): Decision {
  const waived = new Set(input.waivers);
  const questionById = new Map(input.questions.map((question) => [question.id, question]));
  const resultsById = new Map<string, ScreenResult[]>();

  for (const screen of input.screens) {
    for (const result of screen.judge?.results ?? []) {
      const entries = resultsById.get(result.id) ?? [];
      entries.push({ screen: screen.key, result });
      resultsById.set(result.id, entries);
    }
  }

  const aggregates: Aggregate[] = [];
  for (const question of input.questions) {
    const entries = resultsById.get(question.id);
    if (!entries || entries.length === 0) continue;
    const worst = entries.reduce((current, candidate) =>
      quality(question, candidate.result) < quality(question, current.result) ? candidate : current,
    );
    aggregates.push({
      question,
      screen: worst.screen,
      result: worst.result,
      quality: quality(question, worst.result),
    });
  }

  const categories = emptyCategories();
  const categoryHasQuestions = new Set<Category>();
  for (const category of CATEGORIES) {
    const confident = aggregates.filter(
      (entry) => entry.question.category === category
        && entry.result.confidence >= input.thresholds.confidenceMin,
    );
    const denominator = confident.reduce((sum, entry) => sum + entry.question.weight, 0);
    if (denominator > 0) {
      categories[category] = confident.reduce(
        (sum, entry) => sum + entry.question.weight * entry.quality,
        0,
      ) / denominator;
      categoryHasQuestions.add(category);
    }
  }

  const categoryWeightTotal = [...categoryHasQuestions].reduce(
    (sum, category) => sum + input.categoryWeights[category],
    0,
  );
  let overall = categoryWeightTotal > 0
    ? [...categoryHasQuestions].reduce(
      (sum, category) => sum + input.categoryWeights[category] * categories[category],
      0,
    ) / categoryWeightTotal
    : 0;
  if (!input.keyPresent) {
    overall = 0;
    for (const category of CATEGORIES) categories[category] = 0;
  }

  const hardFailures = input.hardFailures.filter((failure) => !waived.has(failure.id));
  const gateFailures = uniqueSorted(
    aggregates
      .filter((entry) => entry.question.gate
        && !waived.has(entry.question.id)
        && entry.result.confidence >= input.thresholds.confidenceMin
        && !entry.result.passed)
      .map((entry) => entry.question.id),
  );
  const uncertain = uniqueSorted(
    aggregates
      .filter((entry) => entry.question.gate
        && !waived.has(entry.question.id)
        && entry.result.confidence < input.thresholds.confidenceMin)
      .map((entry) => entry.question.id),
  );
  const signature = uniqueSorted([
    ...hardFailures.map((failure) => failure.id),
    ...gateFailures,
  ]).join(",");

  const candidateFixes: Fix[] = hardFailures.map((failure) => ({
    id: failure.id,
    text: failure.fix,
    selectors: failure.selectors,
    ...(failure.screen ? { screen: `${failure.screen.route}|${failure.screen.viewport}` } : {}),
    rank: failure.weight,
    source: "deterministic" as const,
  }));

  for (const question of input.questions) {
    if (waived.has(question.id) || question.hidden) continue;
    for (const entry of resultsById.get(question.id) ?? []) {
      if (entry.result.confidence < input.thresholds.confidenceMin || entry.result.passed) continue;
      const source = question.gate ? "gate" as const : "composite" as const;
      candidateFixes.push({
        id: question.id,
        text: fixText(question, entry.result),
        selectors: [],
        screen: entry.screen,
        rank: failureRank(question, entry.result),
        source,
      });
    }
  }

  // One entry per question/gate id: merge screens and selectors, keep the worst rank.
  const mergedFixes = new Map<string, Fix>();
  for (const fix of candidateFixes) {
    const existing = mergedFixes.get(fix.id);
    if (!existing) {
      mergedFixes.set(fix.id, { ...fix, selectors: [...fix.selectors] });
      continue;
    }
    existing.rank = Math.max(existing.rank, fix.rank);
    for (const selector of fix.selectors) {
      if (!existing.selectors.includes(selector) && existing.selectors.length < 8) existing.selectors.push(selector);
    }
    if (fix.screen && !existing.screen) existing.screen = fix.screen;
    else if (fix.screen && existing.screen && !existing.screen.split(", ").includes(fix.screen)) {
      existing.screen = `${existing.screen}, ${fix.screen}`;
    }
  }
  // Measured failures always come first, then failing gates, then composite shortfalls; within a group by rank.
  const sourceOrder: Record<Fix["source"], number> = { deterministic: 0, gate: 1, composite: 2 };
  const rankedFixes = [...mergedFixes.values()].sort((left, right) =>
    sourceOrder[left.source] - sourceOrder[right.source]
      || right.rank - left.rank
      || left.id.localeCompare(right.id),
  );

  const currentQuality = new Map<string, number>();
  for (const aggregate of aggregates) currentQuality.set(aggregate.question.id, aggregate.quality);
  for (const failure of hardFailures) currentQuality.set(failure.id, 0);

  const suppressedIds = new Set<string>();
  for (const id of uniqueSorted(candidateFixes.map((fix) => fix.id))) {
    const sentTurns = input.previous.filter((entry) => entry.fixesSent.includes(id));
    if (sentTurns.length < 2) continue;
    const first = sentTurns[0];
    const priorFixes = first?.decision.fixes.filter((fix) => fix.id === id) ?? [];
    if (priorFixes.length === 0) continue;
    const firstQuality = Math.min(
      ...priorFixes.map((fix) => priorQuality(fix, questionById.get(id))),
    );
    const now = currentQuality.get(id) ?? 0;
    if (now - firstQuality < input.thresholds.epsilon) suppressedIds.add(id);
  }

  // Measured failures lead, but failing gates always get up to three of the slots so the agent sees both kinds.
  const eligible = rankedFixes.filter((fix) => !suppressedIds.has(fix.id));
  const bySource = (source: Fix["source"]): Fix[] => eligible.filter((fix) => fix.source === source);
  const gateFixes = bySource("gate");
  const reservedForGates = Math.min(3, gateFixes.length);
  const measuredFixes = bySource("deterministic").slice(0, Math.max(1, input.thresholds.maxFixes - reservedForGates));
  const fixes = [...measuredFixes, ...gateFixes, ...bySource("composite")]
    .filter((fix, index, all) => all.findIndex((other) => other.id === fix.id) === index)
    .slice(0, input.thresholds.maxFixes);
  const suppressed = uniqueSorted(suppressedIds);
  const previousOverallBest = input.previous.length > 0
    ? Math.max(...input.previous.map((entry) => entry.decision.overall))
    : 0;
  const carriedBest = input.previous.length > 0
    ? Math.max(...input.previous.map((entry) => entry.decision.best))
    : 0;
  const best = Math.max(overall, carriedBest);

  let verdict: Decision["verdict"];
  let reason: string | undefined;
  const noHard = hardFailures.length === 0;

  if (!input.keyPresent) {
    if (noHard) {
      verdict = "APPROVED";
      reason = "facts-only (KEY NEEDED)";
    } else if (input.turn >= input.thresholds.maxIterations) {
      verdict = "STOP";
      reason = "maximum iterations reached (facts-only; KEY NEEDED)";
    } else if (signature.length > 0 && input.previous.some((entry) => entry.decision.signature === signature)) {
      verdict = "STOP";
      reason = "failure signature repeated (facts-only; KEY NEEDED)";
    } else {
      verdict = "REVISE";
      reason = "facts-only (KEY NEEDED)";
    }
  } else {
    const categoriesPass = [...categoryHasQuestions].every(
      (category) => categories[category] >= input.thresholds.categoryFloor,
    );
    if (noHard
      && gateFailures.length === 0
      && overall >= input.thresholds.approve
      && categoriesPass) {
      verdict = "APPROVED";
    } else {
      const last = input.previous.at(-1);
      const repeatedUncertainty = uncertain.length > 0
        && last !== undefined
        && uncertain.every((id) => last.decision.uncertain.includes(id));
      const repeatedSignature = signature.length > 0
        && input.previous.some((entry) => entry.decision.signature === signature);
      const previousAlsoRegressed = last !== undefined
        && last.decision.overall < previousOverallBest - input.thresholds.epsilon;
      const doubleRegression = previousAlsoRegressed
        && overall < previousOverallBest - input.thresholds.epsilon;

      if (repeatedUncertainty) {
        verdict = "ESCALATE";
        reason = "the same gate questions remain uncertain";
      } else if (input.turn >= input.thresholds.maxIterations) {
        verdict = "STOP";
        reason = "maximum iterations reached";
      } else if (repeatedSignature) {
        verdict = "STOP";
        reason = "failure signature repeated";
      } else if (doubleRegression) {
        verdict = "STOP";
        reason = "overall score regressed for two consecutive turns";
      } else {
        verdict = "REVISE";
      }
    }
  }

  return {
    verdict,
    ...(reason === undefined ? {} : { reason }),
    overall,
    best,
    categories,
    hardFailures,
    gateFailures,
    uncertain,
    fixes,
    suppressed,
    signature,
  };
}
