import type { Brand, DomSnapshot, Measurements } from "../types.js";

const properties = [
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "gap", "row-gap", "column-gap",
];

export const compileSpaceMeasurements = (
  snapshot: DomSnapshot,
  brand: Brand,
): Pick<Measurements, "spacingValuesPx" | "offGridRatio"> & { gridPx: number; distinctGaps: number } => {
  const spacingValuesPx = snapshot.elements.flatMap((element) => properties
    .map((property) => Number.parseFloat(element.styles[property] ?? "0"))
    .filter((value) => Number.isFinite(value) && value > 0));
  const gridPx = brand.spacing.base || 4;
  const offGrid = spacingValuesPx.filter((value) => {
    const remainder = value % gridPx;
    return Math.min(Math.abs(remainder), Math.abs(gridPx - remainder)) > 0.01;
  });
  return {
    spacingValuesPx,
    offGridRatio: spacingValuesPx.length === 0 ? 0 : offGrid.length / spacingValuesPx.length,
    gridPx,
    distinctGaps: new Set(spacingValuesPx.map((value) => Math.round(value * 100) / 100)).size,
  };
};
