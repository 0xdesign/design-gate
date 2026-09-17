# design-gate — implementation spec (read this before touching code)

design-gate is a CLI + Agent Skill that makes coding agents iterate on generated UI until a calibrated judge approves it.
Pipeline per check:  capture (Playwright) → facts (deterministic, bucketed) → observations (agent-written or API vision) → judge (TypeSafe Jev, typed questions) → decide (gates + composite + anti-oscillation) → report + run page + provenance.

All shared types and zod schemas live in `src/types.ts`. Import from there; never redefine shapes. ESM, strict TypeScript, Node ≥20, no default exports, small pure functions, tests in `tests/` with vitest, **no network in tests**.

## Directory map

| Path | Owns |
|---|---|
| `src/types.ts` | zod schemas + TS types for config, brand, facts, observations, bank, judge results, decision, run/turn records |
| `src/capture/playwright.ts` | open dev server URL, freeze motion, wait fonts/network idle, screenshot per route×viewport, DOM+computed-style snapshot, axe results |
| `src/facts/*.ts` | pure compilers from a `DomSnapshot` to `Measurements` (raw numbers) and `Facts` (buckets); `src/facts/gates.ts` = deterministic gates |
| `src/observe/schema.ts` | observations zod schema (in types.ts) + validation helpers; `agent.ts` writes `observe-request.json`, reads `observations.json`; `claude.ts` optional API observer |
| `src/judge/bank.ts` | load + validate `questions/bank.yaml`; `jev.ts` = TypeSafe client (`@typesafe-ai/sdk`) with retries; `fake.ts` = deterministic FakeJudge for tests; `state.ts` = assemble Jev `state` |
| `src/decide/decide.ts` | decision function (see §Decision) |
| `src/run/store.ts` | run directory layout, `run.json`, `turn-<n>.json`, hashing, cache; `page.ts` renders `index.html` from `run.json` |
| `src/report/*.ts` | markdown/json/terminal report incl. verdict line |
| `src/init/*.ts` | agent detection, skill install, framework/dev-server/route detection, brand extraction, config write, key storage |
| `src/cli/main.ts` | commander CLI: `init login status report check explain waive open runs` |
| `questions/bank.yaml` | question bank (designer-authored) |
| `skills/design-gate/SKILL.md` | the Agent Skill installed into agents |
| `fixtures/` | static HTML fixture sites used by tests |

## Files on disk at runtime

- `design-gate.yml` (project root) — config, see `ConfigSchema`.
- `brand.json` (project root, or path in config) — see `BrandSchema`.
- `.design-gate/` (gitignored):
  - `state.json` — last content hash of `uiGlobs`, open run id.
  - `runs/<runId>/run.json`, `runs/<runId>/turn-<n>.json`, `runs/<runId>/shots/<route-slug>-<viewport>-<n>.png`, `runs/<runId>/index.html`
  - `observe-request.json`, `observations.json` — agent-observer exchange for the *current* turn.
- `~/.design-gate/config.json` (mode 0600) — `{ "typesafeApiKey": "...", "anthropicApiKey"?: "..." }`. Never written inside the project.

Key resolution order: `TYPESAFE_API_KEY` env → `~/.design-gate/config.json` → none (facts-only mode, verdict notes `KEY NEEDED`). The CLI never prompts for a key except in `init` and `login` (interactive TTY only, hidden input).

## Verdict lines (last line of `check` stdout, exact prefixes)

```
DESIGN_GATE: APPROVED
DESIGN_GATE: REVISE — do not report the task as done. <n> fixes listed above.
DESIGN_GATE: OBSERVATIONS NEEDED — view the screenshots listed in .design-gate/observe-request.json, write .design-gate/observations.json, then re-run `design-gate check`.
DESIGN_GATE: ESCALATE — human review needed. Summarize and stop.
DESIGN_GATE: STOP — <reason>. Summarize and stop.
DESIGN_GATE: SKIPPED — <reason>.
```
Exit codes: APPROVED 0; REVISE 3; OBSERVATIONS NEEDED 4; ESCALATE 5; STOP 6; SKIPPED 0 (fail-open); usage/config error 2.

## Buckets (must match `src/types.ts` const arrays exactly)

Counts: `"0" | "1-2" | "3-5" | "6+"`. Shares: `"none" | "few" | "some" | "most"` (few <10%, some 10–30%, most >30%). Palette size: `"1-3" | "4-6" | "7-10" | "11+"`. Distinct sizes/gaps: `"1-4" | "5-8" | "9+"`. Radii/shadows distinct: `"0" | "1" | "2-3" | "4+"`. Body px: `"<14" | "14-15" | "16+"`. Line chars: `"<45" | "45-75" | "76-90" | "91+"`. Durations: `"none" | "<150" | "150-400" | "400+"`. CTAs above fold: `"0" | "1" | "2" | "3+"`. Density: `"sparse" | "moderate" | "dense"`.

## Facts rules (Jev jaggedness)
- Everything countable is counted in code and bucketed. Raw numbers go to `Measurements` (for provenance + deterministic gates), buckets go to `Facts` (sent to Jev).
- Every example carries a CSS selector (prefer `data-testid`, then id, then short class path).
- Keep `Facts` ≤ ~2K tokens per screen; `Observations` ≤ ~1K; `Brand` ≤ ~1K.

## Deterministic gates (decided in code, never sent to Jev)
`contrast_fails` (WCAG AA text contrast < 4.5:1 for body, < 3:1 for large), `small_targets` (interactive elements < 44×44 CSS px on mobile viewport), `focus_visible_missing` (any focusable element whose `:focus-visible` outline/box-shadow is none), `axe_serious` (axe impact serious/critical), `heading_outline` ∈ {skips_level, multiple_h1, no_h1}, `cross_screen.button_signatures ≥ "3+"` (primary buttons with 3+ distinct bg/radius/height signatures across screens), `cross_screen.radii_union = "4+"`.

## Judge
- Bank entry schema: `QuestionSchema` in types.ts. `pass` semantics: noul → fails when `bad_if_true ? p ≥ threshold : p < threshold`; score → normalized `score/(levels-1)`, fails when < threshold; choice → fails when `choice ∉ pass_choices`.
- One Jev request per screen: `state = { brief: {route, viewport, screen_type?}, brand, facts, observations }`; `questions` = all applicable bank entries (filter by `applies_to` intent and `needs`). Model `jev-latest`. Retries with backoff on 429/529 (max 3). Any client/network error → `judgeError` in the turn record and the run falls back to deterministic gates only + `SKIPPED` note for Jev questions.
- `FakeJudge` (tests, `--judge fake`): deterministic rules over facts/observations (e.g. anti_generic p = 0.2 + 0.3·generic_traits.length capped at 0.95) so fixtures produce stable verdicts.

## Decision (src/decide/decide.ts)
```
hard      = deterministic gate failures
jev_fail  = gate questions with confidence ≥ confidenceMin and failing
uncertain = gate questions with confidence < confidenceMin
category  = Σ w·norm(p) / Σ w over confident questions in category (hidden questions included)
overall   = Σ categoryWeight[c]·category[c]
APPROVED  if !hard && !jev_fail && overall ≥ approve && min(category) ≥ categoryFloor
ESCALATE  if uncertain non-empty and uncertain ⊆ previousTurn.uncertain
STOP      if turn ≥ maxIterations, or failure signature (sorted ids of hard+jev_fail) seen in an earlier turn of this run, or overall < best−epsilon for two consecutive turns
REVISE    otherwise: fixes = top N (default 6) of hard + jev_fail + composite shortfalls ranked by weight·(1−p), excluding fixes already sent twice without the question improving; hidden questions never emit fixes
```
Category weights default: brand .25, craft .25, ux .20, a11y .15, pattern .10, copy .05.

## Run & provenance
`run.json`: `{ runId, status: running|approved|escalated|stopped, startedAt, endedAt?, configHash, brandHash, bankHash, iterations: TurnSummary[] }`. `turn-<n>.json` = `TurnRecord` (full inputs incl. exact Jev state, outputs per question, decision trace, usage/latency/cost, observationsAuthor, cacheHit). Written **before** the verdict is printed. A new run starts when the previous run is terminal; otherwise `check` appends a turn.
Cache: if the content hash of `uiGlobs` equals `state.json.lastHash` and the last turn exists, return the last verdict with `cacheHit: true` without capturing or calling Jev.

## Run page (`index.html`)
Pure render of `run.json` + turns: filmstrip of iterations (screenshots, verdict badge, overall + category bars, fixes sent, resolved/persisted markers), before/after slider, "what changed" file list, per-iteration "Why" panel (every question: p bar, threshold marker, gate badge, state fields read; deterministic gates with measured values + selectors), banner for `KEY NEEDED` / facts-only. `<meta http-equiv="refresh" content="3">` while status is running. Fable owns the visual design (template in `templates/run-page.html`, read at runtime from the package root); code binds data only: replace `/*__DATA__*/` with `{"run":RunRecord,"turns":TurnRecord[]}` JSON (escape `</`), and `<!--__REFRESH__-->` with `<meta http-equiv="refresh" content="3">` while the run is running. Screenshot paths in the injected JSON are relative to the run directory (`shots/...`).

## `check --json` output (stdout; human report goes to stderr when --json is set)
```json
{ "verdict": "APPROVED|REVISE|OBSERVATIONS_NEEDED|ESCALATE|STOP|SKIPPED", "reason": "string?", "runId": "…", "turn": 2,
  "overall": 0.71, "best": 0.74, "categories": { "brand": 0.4, "craft": 0.7, "ux": 0.9, "a11y": 0.8, "pattern": 0.6, "copy": 0.8 },
  "fixes": [ { "id": "brand.palette_fit", "text": "…", "selectors": [".cta"], "screen": "/|mobile", "rank": 2.4, "source": "gate|deterministic|composite" } ],
  "hardFailures": [ { "id": "det.contrast", "measured": "…", "selectors": [".muted"], "fix": "…" } ],
  "notes": ["KEY NEEDED"], "observeRequest": ".design-gate/observe-request.json" | null,
  "runPage": ".design-gate/runs/<runId>/index.html", "screenshots": [ { "key": "/|desktop", "path": "…png" } ],
  "cost": { "usd": 0.0031, "inputTokens": 7400 }, "cacheHit": false }
```
Paths are relative to the project root. `report` prints the same JSON but never appends a turn or changes run state (it writes to `.design-gate/reports/<timestamp>/`).
