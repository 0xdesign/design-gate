# design-gate

A design approval loop for coding agents. It renders your app, measures it, asks a calibrated judge (TypeSafe's Jev) a bank of design questions, and hands the agent a ranked fix list. The agent fixes and re-runs until the gate approves, and you watch every turn on a local page.

```bash
npx design-gate init     # one command: detects your agents, framework, dev server, routes and brand tokens
```

From then on, Claude Code, Codex, Cursor and Gemini (via the installed Agent Skill) run `design-gate check` after UI edits and keep fixing until the verdict is `APPROVED`.

## What it checks

- **Measured (deterministic):** colors versus your brand tokens, WCAG contrast, font families, type scale, body size, line length, spacing grid, distinct radii and shadows, tap targets, focus-visible, axe violations, heading outline, landmarks, motion durations and reduced-motion, above-the-fold density, horizontal overflow, and consistency across screens.
- **Judged (Jev, calibrated probabilities):** brand fit, generic-template tells, hierarchy, restraint, screen conventions, the biggest missing pattern, color-only meaning, copy specificity and tone.

Gates must pass; the rest rolls into a weighted score. Every failing question carries a designer-written fix.

## Keys

Bring your own TypeSafe key (`design-gate login`, stored in `~/.design-gate/` with mode 0600, or `TYPESAFE_API_KEY`). Without a key the measured checks still run. The observer step uses your coding agent's own vision, so no second key is needed; set `observer: api` in `design-gate.yml` to use the Anthropic API in CI.

## Commands

`init` · `check [--json] [--routes …] [--no-vision]` · `report` (dry run) · `explain <question-id>` · `waive <id> --reason …` · `open` · `runs` · `login` · `status`

## Files

- `design-gate.yml` — routes, viewports, thresholds, dev server, UI globs.
- `brand.json` — palette tokens, typefaces, radius, spacing, voice, forbidden words.
- `.design-gate/runs/<id>/index.html` — the run page: screenshots per turn, verdicts, fixes, and a "why" panel per decision.

MIT.
