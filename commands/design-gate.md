---
description: Run the design gate on the current project and loop on fixes until it approves
---
Run the design gate now. Follow the `design-gate` skill exactly: run `npx design-gate check --json`, act on the verdict (write observations if asked, apply fixes in ranked order, re-run), tell the user the run page path on the first REVISE, and stop only at APPROVED, ESCALATE, STOP, or SKIPPED. If the project has no `design-gate.yml`, run `npx design-gate init` first. $ARGUMENTS
