import type { Verdict } from "../types.js";
import type { CheckJson } from "./json.js";

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const renderVerdictLine = (verdict: Verdict, n: number, reason?: string): string => {
  switch (verdict) {
    case "APPROVED": return "DESIGN_GATE: APPROVED";
    case "REVISE": return `DESIGN_GATE: REVISE — do not report the task as done. ${n} fixes listed above.`;
    case "OBSERVATIONS_NEEDED": return "DESIGN_GATE: OBSERVATIONS NEEDED — view the screenshots listed in .design-gate/observe-request.json, write .design-gate/observations.json, then re-run `design-gate check`.";
    case "ESCALATE": return "DESIGN_GATE: ESCALATE — human review needed. Summarize and stop.";
    case "STOP": return `DESIGN_GATE: STOP — ${reason ?? "design iteration stopped"}. Summarize and stop.`;
    case "SKIPPED": return `DESIGN_GATE: SKIPPED — ${reason ?? "not run"}.`;
  }
};

export const renderHuman = (json: CheckJson): string => {
  const lines = [
    `${json.verdict.replaceAll("_", " ")} · score ${percent(json.overall)} · best ${percent(json.best)} · turn ${json.turn}`,
  ];
  if (json.hardFailures.length > 0) {
    lines.push("Hard failures:");
    for (const failure of json.hardFailures) {
      lines.push(`- ${failure.id}: ${failure.measured}${failure.selectors.length ? ` [${failure.selectors.join(", ")}]` : ""}`);
    }
  }
  if (json.fixes.length > 0) {
    lines.push(json.verdict === "APPROVED" ? "Suggestions (non-blocking):" : "Fixes:");
    json.fixes.forEach((fix, index) => {
      const context = [fix.screen, fix.selectors.length ? fix.selectors.join(", ") : undefined].filter(Boolean).join(" · ");
      lines.push(`${index + 1}. ${fix.id}: ${fix.text}${context ? ` (${context})` : ""}`);
    });
  }
  if (json.notes.length > 0) lines.push(...json.notes.map((note) => `Note: ${note}`));
  if (json.observeRequest) lines.push(`Observe request: ${json.observeRequest}`);
  if (json.runPage) lines.push(`Run page: ${json.runPage}`);
  lines.push(renderVerdictLine(json.verdict, json.fixes.length, json.reason));
  return lines.join("\n");
};
