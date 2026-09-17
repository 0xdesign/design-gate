import type { DomSnapshot, Measurements } from "../types.js";

export const normalizeRadius = (value: string | undefined): number | null => {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw || raw === "0px" || raw === "0") return null;
  if (raw.includes("50%")) return 9_999;
  const values = raw.split(/\s+/).map((part) => Number.parseFloat(part)).filter(Number.isFinite);
  if (values.length === 0 || values.every((radius) => radius === 0)) return null;
  if (values.some((radius) => radius >= 999)) return 9_999;
  return Math.round(Math.max(...values) * 100) / 100;
};

export const compileShapeMeasurements = (
  snapshot: DomSnapshot,
): Pick<Measurements, "radiiPx" | "shadows"> => {
  const radiiPx = [...new Set(snapshot.elements
    .map((element) => normalizeRadius(element.styles["border-radius"]))
    .filter((radius): radius is number => radius !== null))].sort((a, b) => a - b);
  const shadows = [...new Set(snapshot.elements
    .map((element) => element.styles["box-shadow"]?.trim() ?? "")
    .filter((shadow) => shadow !== "" && shadow !== "none"))];
  return { radiiPx, shadows };
};
