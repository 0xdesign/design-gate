---
name: design-gate
description: Run the design gate after any UI change and keep fixing until it approves. Use whenever you build, restyle, or touch pages, screens, components, layouts, styles, or copy in a web app, and whenever the user says "design gate", "check the design", or asks whether the UI is good enough. Do not use for backend-only, test-only, config, or docs changes.
---

# design-gate

design-gate renders the app, measures it, asks a calibrated judge (TypeSafe Jev) a bank of design questions, and returns a ranked fix list. Your job is a loop: **check → fix → check** until the verdict is `APPROVED`. The user watches every turn on a local run page.

## When to run it

- After you finish a batch of UI edits (files under `app/`, `src/`, `components/`, `pages/`, or any `.css/.scss/.tsx/.jsx/.vue/.svelte/.astro/.html`), and always **before you tell the user the task is done**.
- When the user asks for a design check by name.
- Not after backend, test, config, or documentation-only edits.
- If the project has no `design-gate.yml`, run `npx design-gate init` first (it is zero-config; it may print a signup link for the user, see "API key" below).

## The loop

1. Run:
   ```bash
   npx design-gate check --json
   ```
   The dev server is started automatically when `design-gate.yml` has a command. Read the JSON on stdout; the last line of the human output is the verdict line (`DESIGN_GATE: …`). Exit codes: 0 approved or skipped, 3 revise, 4 observations needed, 5 escalate, 6 stop.

2. Act on the verdict:
   - **`OBSERVATIONS_NEEDED`** — open `.design-gate/observe-request.json`. For every screen listed, **view the screenshot** and write `.design-gate/observations.json` in the exact shape of `schemaHint` (closed vocabularies only; copy `runId` and `turn` from the request). Then re-run the check. Be exact and complete: list every generic template trait you can actually see, record the headline and primary button text verbatim, and pick `none_clear` for the focal point when nothing dominates. Your observations are shown next to the screenshot on the run page, so a person can audit them.
   - **`REVISE`** — apply the fixes in `fixes[]` in order (highest `rank` first). Each fix names the question, the selectors it applies to, and the screen. Fix the cause in the source, not by hiding elements. Then re-run the check.
   - **`APPROVED`** — you are done with the design loop. Tell the user the score and the run page path.
   - **`ESCALATE`** — the judge is not confident about a gate two turns in a row. Stop editing. Summarize for the user what is uncertain and point them at the run page and screenshots.
   - **`STOP`** — the loop hit its limit or stopped improving. Stop editing. Report the best iteration and what remained.
   - **`SKIPPED`** — the gate could not run (dev server unreachable, no routes, capture failure). Do not treat this as a pass. Tell the user the reason from `notes[]`.

3. Narrate one line per iteration to the user, for example: `design-gate turn 2: 0.71 → 0.78, applied 3 fixes, 1 remaining (brand.palette_fit).`

4. On the first `REVISE` of a run, tell the user where to watch: the `runPage` path from the JSON (`.design-gate/runs/<run-id>/index.html`). If you have a browser tool, open that file for them. The page refreshes itself every few seconds while the run is active.

## Rules you must not break

- **Never edit** `design-gate.yml`, `brand.json`, `questions/bank.yaml`, waiver files, or anything under `.design-gate/` other than `observations.json`. Never lower thresholds, disable the gate, or remove routes to pass.
- **Never fake observations.** Under-reporting what you see is the one way to cheat the gate; it is visible on the run page and it defeats the point.
- **Never handle the API key.** If `notes[]` contains `KEY NEEDED`, the check ran in facts-only mode. Tell the user, in one line, to run `design-gate login` in their own terminal (it opens the TypeSafe console for a key). Do not ask them to paste a key into chat, and do not write a key into any file or environment file.
- Do not waive questions yourself. `design-gate waive` is for the human; if a fix is genuinely wrong for this design, say so to the user and let them waive it.
- Keep looping until a terminal verdict. Do not declare the UI done while the last verdict is `REVISE` or `OBSERVATIONS_NEEDED`.

## Reading `check --json`

```json
{
  "verdict": "REVISE",
  "runId": "20260917-181503-a1f2",
  "turn": 2,
  "overall": 0.71,
  "best": 0.74,
  "categories": { "brand": 0.4, "craft": 0.7, "ux": 0.9, "a11y": 0.8, "pattern": 0.6, "copy": 0.8 },
  "fixes": [
    { "id": "brand.palette_fit", "text": "Replace the hard-coded colors …", "selectors": [".hero .cta"], "screen": "/|mobile", "rank": 2.4, "source": "gate" }
  ],
  "hardFailures": [ { "id": "det.contrast", "measured": "contrast 3.20:1 on .muted (needs 4.5:1)", "selectors": [".muted"] } ],
  "notes": [],
  "observeRequest": null,
  "runPage": ".design-gate/runs/20260917-181503-a1f2/index.html",
  "screenshots": [ { "key": "/|desktop", "path": ".design-gate/runs/…/shots/root-desktop-2.png" } ]
}
```

`hardFailures` are measured, deterministic failures (contrast, tap targets, focus styles, axe, heading outline, cross-screen drift). They always come first. `fixes` merge those with the judge's failing questions, ranked by weight × how badly they failed.

## Useful commands

| Command | Use |
|---|---|
| `npx design-gate init` | Zero-config setup: detects agents, framework, dev server, routes, brand tokens; installs this skill; asks the user for their key once. |
| `npx design-gate check --json` | The gate. Add `--routes /pricing` to narrow, `--no-vision` for facts-only. |
| `npx design-gate report` | Non-blocking dry run with the same output; never blocks and never counts as a turn. |
| `npx design-gate explain <question-id>` | Shows a question, its criteria, and the state fields it read on the last turn. |
| `npx design-gate open` / `runs` | Open the current run page / list past runs with verdicts and cost. |
| `design-gate login` / `status` | Human-only: store or inspect the TypeSafe key. |

## What the gate measures (so your fixes land)

Deterministic: colors vs brand tokens, contrast, font families, type scale, body size, line length, spacing grid, distinct gaps, radii and shadows, tap targets, focus-visible, axe violations, heading outline, landmarks, motion durations and reduced-motion, above-fold density, horizontal overflow, and consistency across screens. Judged: brand fit, generic-template tells, hierarchy, restraint, screen conventions, missing patterns, color-only meaning, copy specificity and tone. Fixes that change the measured facts are the ones that move the score.
