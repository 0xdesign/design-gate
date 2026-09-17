import type { Brand, CrossScreenFacts, GateFailure, ScreenAnalysis } from "../types.js";
import { parseColor } from "./color.js";
import { normalizeRadius } from "./shape.js";

const capped = (selectors: string[]): string[] => [...new Set(selectors)].slice(0, 5);
const screenRef = (screen: ScreenAnalysis): { route: string; viewport: string } => ({
  route: screen.snapshot.route,
  viewport: screen.snapshot.viewport.name,
});

export const deterministicGates = (
  screens: ScreenAnalysis[],
  cross: CrossScreenFacts,
  _brand: Brand,
): GateFailure[] => {
  const failures: GateFailure[] = [];

  for (const screen of screens) {
    const { measurements, facts, snapshot } = screen;
    if (measurements.contrastFailures.length > 0) {
      const first = measurements.contrastFailures[0]!;
      failures.push({
        id: "det.contrast",
        category: "a11y",
        screen: screenRef(screen),
        measured: `contrast ${first.ratio.toFixed(2)}:1 on ${first.selector} (needs ${first.required.toFixed(1)}:1)`,
        selectors: capped(measurements.contrastFailures.map((failure) => failure.selector)),
        fix: "Increase text-to-background contrast to meet WCAG AA for every failing selector.",
        weight: 3,
      });
    }

    if (snapshot.viewport.name === "mobile" && measurements.smallTargets.length > 0) {
      const first = measurements.smallTargets[0]!;
      failures.push({
        id: "det.small_targets",
        category: "a11y",
        screen: screenRef(screen),
        measured: `${first.width.toFixed(0)}×${first.height.toFixed(0)}px target on ${first.selector} (needs at least 44×44px)`,
        selectors: capped(measurements.smallTargets.map((target) => target.selector)),
        fix: "Expand each mobile interactive target to at least 44×44 CSS pixels.",
        weight: 3,
      });
    }

    if (measurements.focusVisibleMissing.length > 0) {
      failures.push({
        id: "det.focus_visible",
        category: "a11y",
        screen: screenRef(screen),
        measured: `${measurements.focusVisibleMissing.length} keyboard-focusable element(s) have no visible outline or shadow`,
        selectors: capped(measurements.focusVisibleMissing.map((element) => element.selector)),
        fix: "Add a clearly visible :focus-visible outline or box-shadow to every focusable control.",
        weight: 3,
      });
    }

    if (measurements.axeSerious.length > 0) {
      const nodes = measurements.axeSerious.reduce((sum, violation) => sum + violation.nodes, 0);
      failures.push({
        id: "det.axe",
        category: "a11y",
        screen: screenRef(screen),
        measured: `${nodes} serious or critical axe node(s): ${measurements.axeSerious.map((violation) => violation.id).join(", ")}`,
        selectors: [],
        fix: "Resolve every serious or critical axe violation reported for this screen.",
        weight: 2,
      });
    }

    if (facts.a11y.heading_outline !== "ok") {
      failures.push({
        id: "det.heading_outline",
        category: "a11y",
        screen: screenRef(screen),
        measured: `heading outline is ${facts.a11y.heading_outline}: ${measurements.headingLevels.join(" → ") || "no headings"}`,
        selectors: capped(snapshot.headings.map((heading) => heading.selector)),
        fix: "Use one h1 and a sequential heading hierarchy without skipped levels.",
        weight: 1,
      });
    }

    if (snapshot.hasViewportMetaScaleLock) {
      failures.push({
        id: "det.viewport_scale_lock",
        category: "a11y",
        screen: screenRef(screen),
        measured: "viewport meta prevents or caps user zoom",
        selectors: ["meta[name=\"viewport\"]"],
        fix: "Remove user-scalable=no and maximum-scale=1 from the viewport meta tag.",
        weight: 2,
      });
    }

    if (snapshot.viewport.name === "mobile" && measurements.horizontalOverflow) {
      failures.push({
        id: "det.horizontal_overflow",
        category: "craft",
        screen: screenRef(screen),
        measured: `document width ${snapshot.documentScrollWidth}px exceeds viewport width ${snapshot.viewportWidth}px`,
        selectors: [],
        fix: "Constrain or wrap the overflowing content so the page fits the mobile viewport.",
        weight: 2,
      });
    }
  }

  if (cross.button_signatures === "4+") {
    const selectors = screens.flatMap((screen) => screen.snapshot.elements
      .filter((element) => (element.tagName === "button" || element.tagName === "a") && parseColor(element.styles["background-color"]) !== null)
      .map((element) => element.selector));
    failures.push({
      id: "det.cross_screen_buttons",
      category: "craft",
      measured: `${cross.button_signatures} distinct primary button signatures across screens`,
      selectors: capped(selectors),
      fix: "Standardize primary button background, radius, and height across every route and viewport.",
      weight: 2,
    });
  }

  if (cross.radii_union === "4+") {
    const selectors = screens.flatMap((screen) => screen.snapshot.elements
      .filter((element) => normalizeRadius(element.styles["border-radius"]) !== null)
      .map((element) => element.selector));
    failures.push({
      id: "det.cross_screen_radii",
      category: "craft",
      measured: `${cross.radii_union} distinct radius values across screens`,
      selectors: capped(selectors),
      fix: "Reduce border radii to a small, consistent cross-screen scale.",
      weight: 1,
    });
  }

  return failures;
};
