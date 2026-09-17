/**
 * Shared contracts for design-gate. Every module imports from here; nothing redefines these shapes.
 * zod schemas are the source of truth; TS types are inferred.
 */
import { z } from "zod";

// ---------- Bucket vocabularies (keep in sync with SPEC.md) ----------
export const COUNT_BUCKETS = ["0", "1-2", "3-5", "6+"] as const;
export const SHARE_BUCKETS = ["none", "few", "some", "most"] as const;
export const PALETTE_SIZE_BUCKETS = ["1-3", "4-6", "7-10", "11+"] as const;
export const DISTINCT_BUCKETS = ["1-4", "5-8", "9+"] as const;
export const VARIETY_BUCKETS = ["0", "1", "2-3", "4+"] as const;
export const BODY_PX_BUCKETS = ["<14", "14-15", "16+"] as const;
export const LINE_CHARS_BUCKETS = ["<45", "45-75", "76-90", "91+"] as const;
export const DURATION_BUCKETS = ["none", "<150", "150-400", "400+"] as const;
export const CTA_BUCKETS = ["0", "1", "2", "3+"] as const;
export const DENSITY_BUCKETS = ["sparse", "moderate", "dense"] as const;
export const HEADING_OUTLINE = ["ok", "skips_level", "multiple_h1", "no_h1"] as const;

export const bucketCount = (n: number): (typeof COUNT_BUCKETS)[number] =>
  n <= 0 ? "0" : n <= 2 ? "1-2" : n <= 5 ? "3-5" : "6+";
export const bucketShare = (ratio: number): (typeof SHARE_BUCKETS)[number] =>
  ratio <= 0 ? "none" : ratio < 0.1 ? "few" : ratio <= 0.3 ? "some" : "most";
export const bucketPalette = (n: number): (typeof PALETTE_SIZE_BUCKETS)[number] =>
  n <= 3 ? "1-3" : n <= 6 ? "4-6" : n <= 10 ? "7-10" : "11+";
export const bucketDistinct = (n: number): (typeof DISTINCT_BUCKETS)[number] =>
  n <= 4 ? "1-4" : n <= 8 ? "5-8" : "9+";
export const bucketVariety = (n: number): (typeof VARIETY_BUCKETS)[number] =>
  n <= 0 ? "0" : n === 1 ? "1" : n <= 3 ? "2-3" : "4+";
export const bucketBodyPx = (px: number): (typeof BODY_PX_BUCKETS)[number] =>
  px < 14 ? "<14" : px < 16 ? "14-15" : "16+";
export const bucketLineChars = (n: number): (typeof LINE_CHARS_BUCKETS)[number] =>
  n < 45 ? "<45" : n <= 75 ? "45-75" : n <= 90 ? "76-90" : "91+";
export const bucketDuration = (ms: number | null): (typeof DURATION_BUCKETS)[number] =>
  ms === null || ms <= 0 ? "none" : ms < 150 ? "<150" : ms <= 400 ? "150-400" : "400+";
export const bucketCta = (n: number): (typeof CTA_BUCKETS)[number] =>
  n <= 0 ? "0" : n === 1 ? "1" : n === 2 ? "2" : "3+";

// ---------- Config (design-gate.yml) ----------
export const ViewportSchema = z.object({
  name: z.enum(["desktop", "mobile"]),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export const ThresholdsSchema = z.object({
  approve: z.number().min(0).max(1).default(0.8),
  categoryFloor: z.number().min(0).max(1).default(0.6),
  confidenceMin: z.number().min(0).max(1).default(0.5),
  maxIterations: z.number().int().positive().default(5),
  epsilon: z.number().min(0).max(1).default(0.02),
  maxFixes: z.number().int().positive().default(6),
});
export const BRAND_INTENTS = ["conventional", "expressive", "brutalist"] as const;
export const ConfigSchema = z.object({
  version: z.literal(1).default(1),
  enabled: z.boolean().default(true),
  devServer: z.object({
    url: z.string().url(),
    command: z.string().optional(),
    autoStart: z.boolean().default(true),
    readyTimeoutMs: z.number().int().positive().default(60_000),
  }),
  routes: z.array(z.string()).min(1).default(["/"]),
  viewports: z.array(ViewportSchema).default([
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]),
  uiGlobs: z.array(z.string()).default([
    "app/**/*.{tsx,jsx,vue,svelte,astro,html}",
    "src/**/*.{tsx,jsx,vue,svelte,astro,html,css,scss}",
    "components/**/*.{tsx,jsx,vue,svelte,astro,html,css,scss}",
    "pages/**/*.{tsx,jsx,vue,svelte,astro,html,css,scss}",
    "**/*.css",
  ]),
  brandFile: z.string().default("brand.json"),
  bankFile: z.string().optional(),
  observer: z.enum(["agent", "api", "none"]).default("agent"),
  observerModel: z.string().default("claude-opus-5"),
  judge: z.enum(["jev", "fake"]).default("jev"),
  jevModel: z.string().default("jev-latest"),
  thresholds: ThresholdsSchema.prefault({}),
  categoryWeights: z
    .object({
      brand: z.number().default(0.25),
      craft: z.number().default(0.25),
      ux: z.number().default(0.2),
      a11y: z.number().default(0.15),
      pattern: z.number().default(0.1),
      copy: z.number().default(0.05),
    })
    .prefault({}),
});
export type Config = z.infer<typeof ConfigSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;

// ---------- Brand (brand.json) ----------
export const PALETTE_ROLES = ["primary", "accent", "surface", "background", "text", "muted", "border", "success", "warning", "danger", "neutral"] as const;
export const BrandSchema = z.object({
  name: z.string().default("Untitled"),
  intent: z.enum(BRAND_INTENTS).default("conventional"),
  palette: z.array(z.object({ token: z.string(), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/), role: z.enum(PALETTE_ROLES).optional() })).default([]),
  type: z.array(z.object({ family: z.string(), role: z.enum(["display", "body", "mono", "ui"]).optional() })).default([]),
  radius: z.object({ base: z.number().optional(), scale: z.array(z.number()).default([]) }).prefault({}),
  spacing: z.object({ base: z.number().default(4), scale: z.array(z.number()).default([]) }).prefault({}),
  voice: z.array(z.string()).default([]),
  forbidden: z.array(z.string()).default([]),
  darkMode: z.boolean().default(false),
  sources: z.array(z.string()).default([]),
});
export type Brand = z.infer<typeof BrandSchema>;

// ---------- Capture ----------
export interface ElementIdentifier {
  selector: string;
  tagName: string;
  textContent?: string;
}
export interface ElementRecord extends ElementIdentifier {
  rect: { x: number; y: number; width: number; height: number };
  styles: Record<string, string>; // computed styles subset (color, background-color, font-family, font-size, line-height, padding-*, margin-*, gap, border-radius, box-shadow, transition-*, animation-*, outline, cursor)
  role?: string;
  focusable: boolean;
  interactive: boolean;
  text: string;
  focusVisibleOutline?: string; // outline / box-shadow observed under :focus-visible (probe), if focusable
}
export interface DomSnapshot {
  route: string;
  viewport: Viewport;
  url: string;
  title: string;
  screenshotPath: string;
  screenshotSha256: string;
  elements: ElementRecord[];
  headings: { level: number; text: string; selector: string }[];
  landmarks: string[];
  axe: { id: string; impact: string | null; nodes: number; help: string }[];
  fontsLoaded: string[];
  reducedMotionRespected: boolean;
  motionDurationsMs: number[];
  hasViewportMetaScaleLock: boolean;
  documentScrollWidth: number;
  viewportWidth: number;
}

// ---------- Facts ----------
export const FactsSchema = z.object({
  screen: z.object({ route: z.string(), viewport: z.enum(["desktop", "mobile"]) }),
  color: z.object({
    palette_size: z.enum(PALETTE_SIZE_BUCKETS),
    off_token_share: z.enum(SHARE_BUCKETS),
    off_token_examples: z.array(z.object({ hex: z.string(), selector: z.string() })).max(5),
    contrast_fails: z.enum(COUNT_BUCKETS),
  }),
  type: z.object({
    families: z.array(z.string()).max(6),
    off_brand_families: z.array(z.string()).max(6),
    distinct_sizes: z.enum(DISTINCT_BUCKETS),
    scale_is_regular: z.boolean(),
    min_body_px: z.enum(BODY_PX_BUCKETS),
    longest_line_chars: z.enum(LINE_CHARS_BUCKETS),
  }),
  space: z.object({
    grid_px: z.number(),
    off_grid_share: z.enum(SHARE_BUCKETS),
    distinct_gaps: z.enum(DISTINCT_BUCKETS),
  }),
  shape: z.object({
    radii_distinct: z.enum(VARIETY_BUCKETS),
    shadows_distinct: z.enum(VARIETY_BUCKETS),
  }),
  a11y: z.object({
    small_targets: z.enum(COUNT_BUCKETS),
    focus_visible_missing: z.boolean(),
    axe_serious: z.enum(COUNT_BUCKETS),
    heading_outline: z.enum(HEADING_OUTLINE),
    landmarks: z.array(z.string()).max(8),
  }),
  motion: z.object({
    durations: z.enum(DURATION_BUCKETS),
    reduced_motion_respected: z.boolean(),
  }),
  density: z.object({
    ctas_above_fold: z.enum(CTA_BUCKETS),
    above_fold: z.enum(DENSITY_BUCKETS),
    horizontal_overflow: z.boolean(),
  }),
});
export type Facts = z.infer<typeof FactsSchema>;

export const CrossScreenFactsSchema = z.object({
  button_signatures: z.enum(VARIETY_BUCKETS),
  radii_union: z.enum(VARIETY_BUCKETS),
  palette_union: z.enum(PALETTE_SIZE_BUCKETS),
  font_family_union: z.enum(VARIETY_BUCKETS),
});
export type CrossScreenFacts = z.infer<typeof CrossScreenFactsSchema>;

/** Raw numbers behind the buckets; kept for provenance and deterministic gates. Never sent to Jev. */
export interface Measurements {
  colorsUsed: { hex: string; count: number; onToken: string | null; selectors: string[] }[];
  offTokenRatio: number;
  contrastFailures: { selector: string; ratio: number; required: number; fg: string; bg: string }[];
  fontFamilies: string[];
  fontSizesPx: number[];
  minBodyPx: number;
  longestLineChars: number;
  spacingValuesPx: number[];
  offGridRatio: number;
  radiiPx: number[];
  shadows: string[];
  smallTargets: { selector: string; width: number; height: number }[];
  focusVisibleMissing: { selector: string }[];
  axeSerious: { id: string; nodes: number; help: string }[];
  headingLevels: number[];
  motionDurationsMs: number[];
  ctasAboveFold: { selector: string; text: string }[];
  aboveFoldElementCount: number;
  horizontalOverflow: boolean;
}

export interface ScreenAnalysis {
  snapshot: DomSnapshot;
  facts: Facts;
  measurements: Measurements;
}

// ---------- Deterministic gates ----------
export interface GateFailure {
  id: string; // e.g. "det.contrast", "det.small_targets", "det.focus_visible", "det.axe", "det.heading_outline", "det.cross_screen"
  category: "a11y" | "craft" | "brand";
  screen?: { route: string; viewport: string };
  measured: string; // human-readable measured value, e.g. "contrast 3.2:1 on .muted (needs 4.5:1)"
  selectors: string[];
  fix: string;
  weight: number;
}

// ---------- Observations ----------
export const SCREEN_TYPES = ["landing", "dashboard", "form", "list", "detail", "settings", "auth", "other"] as const;
export const FOCAL_POINTS = ["headline", "image", "form", "cta", "data", "none_clear"] as const;
export const GENERIC_TRAITS = [
  "cream_serif_terracotta",
  "dark_acid_green",
  "saas_card_kit",
  "allcaps_eyebrow",
  "arrow_on_button",
  "gradient_blob",
  "three_col_features",
  "numbered_steps_decoration",
  "single_word_accent_headline",
  "middle_dot_meta",
] as const;
export const UI_PATTERNS = [
  "stepper", "empty_state", "bottom_sheet", "inline_validation", "skeleton", "toast", "modal",
  "tabs", "table", "card_grid", "hero", "pricing_table", "faq_accordion", "search", "filters",
  "pagination", "breadcrumbs", "sidebar_nav", "top_nav", "footer", "form", "onboarding", "progress",
] as const;
export const MOODS = ["clinical", "playful", "editorial", "luxurious", "utilitarian", "friendly", "technical", "bold", "quiet", "generic"] as const;
export const ObservationsSchema = z.object({
  screen_type: z.enum(SCREEN_TYPES),
  focal_point: z.enum(FOCAL_POINTS),
  hierarchy_levels: z.enum(["1", "2", "3", "4+"]),
  reading_order: z.enum(["clear", "ambiguous"]),
  status_encoding: z.enum(["color_only", "color_plus_icon", "color_plus_text", "na"]),
  patterns_present: z.array(z.enum(UI_PATTERNS)).max(12),
  generic_traits: z.array(z.enum(GENERIC_TRAITS)).max(10),
  copy: z.object({
    headline: z.string().max(200).default(""),
    primary_cta: z.string().max(80).default(""),
    empty_state: z.string().max(200).default(""),
  }),
  mood: z.array(z.enum(MOODS)).max(3),
  notes: z.string().max(600).optional(), // human escalation packet only; never sent to Jev
});
export type Observations = z.infer<typeof ObservationsSchema>;
export const ObservationsFileSchema = z.object({
  runId: z.string(),
  turn: z.number().int(),
  author: z.string(), // "agent" | "api:<model>"
  screens: z.record(z.string(), ObservationsSchema), // key = `${route}|${viewport}`
});
export type ObservationsFile = z.infer<typeof ObservationsFileSchema>;
export interface ObserveRequest {
  runId: string;
  turn: number;
  screens: { key: string; route: string; viewport: string; screenshotPath: string }[];
  schemaHint: Record<string, unknown>; // enums for the agent, generated from ObservationsSchema
  writeTo: string; // absolute path of observations.json
}

// ---------- Question bank ----------
export const CATEGORIES = ["brand", "craft", "ux", "a11y", "pattern", "copy"] as const;
export type Category = (typeof CATEGORIES)[number];
const EntryType = z.union([z.string(), z.record(z.string(), z.unknown()), z.array(z.unknown())]);
export const QuestionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.]+$/),
  category: z.enum(CATEGORIES),
  type: z.enum(["noul", "score", "choice"]),
  weight: z.number().positive().default(1),
  gate: z.boolean().default(false),
  hidden: z.boolean().default(false),
  threshold: z.number().min(0).max(1).default(0.5),
  applies_to: z.array(z.enum(BRAND_INTENTS)).default([...BRAND_INTENTS]),
  needs: z.array(z.enum(["facts", "observations", "brand"])).default(["facts"]),
  instructions: EntryType,
  criteria: z.unknown().optional(), // noul: {true?,false?}; score: array of levels; choice: record label -> description
  bad_if_true: z.boolean().default(false), // noul only
  pass_choices: z.array(z.string()).default([]), // choice only
  fix: z.string().optional(),
  fix_by_choice: z.record(z.string(), z.string()).optional(),
  refs: z.array(z.string()).default([]),
});
export type Question = z.infer<typeof QuestionSchema>;
export const BankSchema = z.object({ version: z.number().int(), questions: z.array(QuestionSchema).min(1) });
export type Bank = z.infer<typeof BankSchema>;

// ---------- Judge ----------
export interface JevState {
  brief: { route: string; viewport: string; screen_type?: string };
  brand: Brand;
  facts: Facts;
  cross_screen?: CrossScreenFacts;
  observations?: Omit<Observations, "notes">;
}
export interface QuestionResult {
  id: string;
  type: "noul" | "score" | "choice";
  probability: number; // noul p, score normalized 0..1, choice p(chosen)
  confidence: number; // noul: |p-0.5|*2; score/choice: from Jev
  raw: unknown; // exact Jev answer
  passed: boolean;
  gate: boolean;
  hidden: boolean;
  weight: number;
  category: Category;
  threshold: number;
  fix?: string;
}
export interface JudgeResult {
  screenKey: string;
  model: string;
  results: QuestionResult[];
  usage?: { input_tokens: number; output_tokens: number };
  latencyMs: number;
  error?: string;
  stateSent: JevState;
}
export interface Judge {
  name: string;
  judge(state: JevState, questions: Question[]): Promise<JudgeResult>;
}

// ---------- Decision ----------
export type Verdict = "APPROVED" | "REVISE" | "OBSERVATIONS_NEEDED" | "ESCALATE" | "STOP" | "SKIPPED";
export interface Fix {
  id: string;
  text: string;
  selectors: string[];
  screen?: string;
  rank: number; // weight * (1 - p)
  source: "deterministic" | "gate" | "composite";
}
export interface Decision {
  verdict: Verdict;
  reason?: string;
  overall: number;
  best: number;
  categories: Record<Category, number>;
  hardFailures: GateFailure[];
  gateFailures: string[]; // question ids
  uncertain: string[]; // question ids
  fixes: Fix[];
  suppressed: string[]; // fix ids suppressed for being sent twice without improvement
  signature: string;
}

// ---------- Run / provenance ----------
export interface TurnSummary {
  turn: number;
  at: string;
  verdict: Verdict;
  overall: number;
  categories: Record<Category, number>;
  fixesSent: string[];
  fixesResolved: string[];
  fixesPersisted: string[];
  screenshots: { key: string; path: string }[];
  filesChanged: string[];
  costUsd: number;
  cacheHit: boolean;
}
export interface RunRecord {
  runId: string;
  status: "running" | "approved" | "escalated" | "stopped";
  startedAt: string;
  endedAt?: string;
  task?: string;
  configHash: string;
  brandHash: string;
  bankHash: string;
  keyPresent: boolean;
  iterations: TurnSummary[];
}
export interface TurnRecord {
  runId: string;
  turn: number;
  at: string;
  uiHash: string;
  cacheHit: boolean;
  keyPresent: boolean;
  observationsAuthor: "agent" | "api" | "none" | string;
  observationsSha256?: string;
  screens: {
    key: string;
    route: string;
    viewport: string;
    screenshotPath: string;
    screenshotSha256: string;
    facts: Facts;
    measurements: Measurements;
    observations?: Observations;
    judge?: JudgeResult;
  }[];
  crossScreen?: CrossScreenFacts;
  hardFailures: GateFailure[];
  decision: Decision;
  usage: { inputTokens: number; outputTokens: number; latencyMs: number; costUsd: number; model?: string };
  filesChanged: string[];
  waivers: { id: string; by: string; at: string; reason: string }[];
  notes: string[]; // e.g. "KEY NEEDED", "judge error: ..."
}

export const JEV_INPUT_USD_PER_MTOK = 0.042;
