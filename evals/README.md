# Calibration

The question bank is only as good as its agreement with a designer. Calibration is internal (TypeSafe's terms forbid publishing performance claims about Jev) and runs before thresholds are trusted.

## Protocol

1. **Collect ~30 screens.** Mix: the two fixtures (`fixtures/generic-saas`, `fixtures/on-brand`), real pages from your own projects, and a few deliberately unconventional-but-good designs (brutalist, editorial) so the bank is not punished for taste.
2. **Label them.** For each screen record your own verdict per gate question (pass/fail) and an overall 1–5 quality score in `evals/calibration/cases.json` (schema below). Label before looking at Jev's answers.
3. **Replay.** `design-gate report --json` on each screen (or `pnpm tsx evals/replay.ts` once it exists) records every question's probability into `evals/calibration/results/<case>.json`.
4. **Score each question.** For every question compute AUC of its probability against your labels across cases. Keep questions with AUC ≥ 0.7; rewrite or drop the rest. Choose each gate's `threshold` at the point that minimizes false failures on the unconventional-but-good set while catching the generic set.
5. **Re-run after every bank change.** Bank version bumps (`version:` in `questions/bank.yaml`) invalidate previous results.

## `cases.json` schema

```json
[
  {
    "id": "generic-saas-home",
    "url": "http://localhost:4173/",
    "brandFile": "fixtures/generic-saas/brand.json",
    "labels": { "brand.palette_fit": false, "brand.type_fit": false, "craft.anti_generic": false, "ux.primary_action_clear": true, "a11y.color_only_meaning": true },
    "overall": 1,
    "notes": "purple gradient template, off-brand"
  }
]
```

`labels` values are **pass/fail as a designer would judge** (true = passes). `overall` is 1 (reject) to 5 (ship). Results are never committed; only `cases.json` is.
