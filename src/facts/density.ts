import type { DomSnapshot, Measurements } from "../types.js";
import { parseColor } from "./color.js";

const px = (value: string | undefined): number => Number.parseFloat(value ?? "0") || 0;

export const compileDensityMeasurements = (
  snapshot: DomSnapshot,
): Pick<Measurements, "ctasAboveFold" | "aboveFoldElementCount" | "horizontalOverflow"> & { density: "sparse" | "moderate" | "dense" } => {
  const ctasAboveFold = snapshot.elements
    .filter((element) => {
      const padding = px(element.styles["padding-top"]) + px(element.styles["padding-right"]) +
        px(element.styles["padding-bottom"]) + px(element.styles["padding-left"]);
      return element.interactive && (element.tagName === "a" || element.tagName === "button") &&
        parseColor(element.styles["background-color"]) !== null && padding > 0 &&
        element.rect.y + element.rect.height <= snapshot.viewport.height;
    })
    .map((element) => ({ selector: element.selector, text: element.text || element.textContent || "" }));
  const aboveFoldElementCount = snapshot.elements.filter((element) => element.rect.y <= snapshot.viewport.height).length;
  return {
    ctasAboveFold,
    aboveFoldElementCount,
    horizontalOverflow: snapshot.documentScrollWidth > snapshot.viewportWidth + 1,
    density: aboveFoldElementCount < 25 ? "sparse" : aboveFoldElementCount <= 60 ? "moderate" : "dense",
  };
};
