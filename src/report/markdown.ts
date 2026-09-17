import type { CheckJson } from "./json.js";
import { renderVerdictLine } from "./terminal.js";

const percent = (value: number): string => `${Math.round(value * 100)}%`;

export const renderMarkdown = (json: CheckJson): string => {
  const lines = [
    `# design-gate turn ${json.turn}`,
    "",
    `**${json.verdict.replaceAll("_", " ")}** — score ${percent(json.overall)}, best ${percent(json.best)}`,
  ];
  if (json.reason) lines.push("", `Reason: ${json.reason}`);
  if (json.hardFailures.length > 0) {
    lines.push("", "## Hard failures", "");
    for (const failure of json.hardFailures) {
      lines.push(`- **${failure.id}** — ${failure.measured}${failure.selectors.length ? ` (${failure.selectors.join(", ")})` : ""}`);
    }
  }
  if (json.fixes.length > 0) {
    lines.push("", "## Fixes", "");
    json.fixes.forEach((fix, index) => {
      const context = [fix.screen, fix.selectors.length ? fix.selectors.join(", ") : undefined].filter(Boolean).join(" · ");
      lines.push(`${index + 1}. **${fix.id}** — ${fix.text}${context ? ` (${context})` : ""}`);
    });
  }
  if (json.notes.length > 0) lines.push("", "## Notes", "", ...json.notes.map((note) => `- ${note}`));
  lines.push("", `Run page: \`${json.runPage}\``, "", renderVerdictLine(json.verdict, json.fixes.length, json.reason), "");
  return lines.join("\n");
};
