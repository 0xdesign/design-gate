import type { DomSnapshot, Measurements } from "../types.js";
import type { HEADING_OUTLINE } from "../types.js";

export type HeadingOutline = (typeof HEADING_OUTLINE)[number];

export const headingOutline = (levels: number[]): HeadingOutline => {
  const h1Count = levels.filter((level) => level === 1).length;
  if (h1Count === 0) return "no_h1";
  if (h1Count > 1) return "multiple_h1";
  return levels.some((level, index) => index > 0 && level - levels[index - 1]! > 1) ? "skips_level" : "ok";
};

export const compileA11yMeasurements = (
  snapshot: DomSnapshot,
): Pick<Measurements, "smallTargets" | "focusVisibleMissing" | "axeSerious" | "headingLevels"> => {
  const smallTargets = snapshot.elements
    .filter((element) => element.interactive && (element.rect.width < 44 || element.rect.height < 44))
    .map((element) => ({ selector: element.selector, width: element.rect.width, height: element.rect.height }));
  const focusVisibleMissing = snapshot.elements
    .filter((element) => element.focusable && element.focusVisibleOutline !== undefined && element.focusVisibleOutline.toLowerCase() === "none")
    .map((element) => ({ selector: element.selector }));
  const axeSerious = snapshot.axe
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map(({ id, nodes, help }) => ({ id, nodes, help }));
  return {
    smallTargets,
    focusVisibleMissing,
    axeSerious,
    headingLevels: snapshot.headings.map((heading) => heading.level),
  };
};
