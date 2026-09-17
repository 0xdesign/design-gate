import type { DomSnapshot, Measurements } from "../types.js";

const parsePx = (value: string | undefined): number => Number.parseFloat(value ?? "0") || 0;

export const firstFontFamily = (value: string): string =>
  (value.split(",")[0] ?? "").trim().replace(/^['"]|['"]$/g, "");

export const isScaleRegular = (sizes: number[]): boolean => {
  const distinct = [...new Set(sizes.filter((size) => size > 0).map((size) => Math.round(size * 100) / 100))].sort((a, b) => a - b);
  const conventional = new Set([12, 14, 16, 18, 20, 24, 30, 32, 36, 40, 48, 56, 64, 72]);
  if (distinct.length > 0 && distinct.every((size) => conventional.has(size))) return true;
  if (distinct.length < 3) return false;
  const ratios = distinct.slice(1).map((size, index) => size / distinct[index]!);
  const mean = ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
  const variance = ratios.reduce((sum, ratio) => sum + (ratio - mean) ** 2, 0) / ratios.length;
  return mean > 0 && Math.sqrt(variance) / mean < 0.25;
};

export const compileTypeMeasurements = (
  snapshot: DomSnapshot,
): Pick<Measurements, "fontFamilies" | "fontSizesPx" | "minBodyPx" | "longestLineChars"> & { scaleIsRegular: boolean } => {
  const fontFamilies = [...new Set(snapshot.elements
    .map((element) => firstFontFamily(element.styles["font-family"] ?? ""))
    .filter(Boolean))].slice(0, 6);
  const fontSizesPx = [...new Set(snapshot.elements
    .map((element) => Math.round(parsePx(element.styles["font-size"])))
    .filter((size) => size > 0))].sort((a, b) => a - b);
  const bodySizes = snapshot.elements
    .filter((element) => element.text.length >= 40)
    .map((element) => parsePx(element.styles["font-size"]))
    .filter((size) => size > 0);
  const minBodyPx = bodySizes.length > 0 ? Math.min(...bodySizes) : 0;
  const longestLineChars = snapshot.elements.reduce((longest, element) => {
    if (!element.text) return longest;
    const fontSize = parsePx(element.styles["font-size"]);
    const rawLineHeight = parsePx(element.styles["line-height"]);
    const lineHeight = rawLineHeight > 0 ? rawLineHeight : fontSize * 1.2;
    const lines = Math.max(1, Math.round(element.rect.height / Math.max(1, lineHeight)));
    return Math.max(longest, element.text.length / lines);
  }, 0);
  return { fontFamilies, fontSizesPx, minBodyPx, longestLineChars, scaleIsRegular: isScaleRegular(fontSizesPx) };
};

export const offBrandFamilies = (families: string[], brandFamilies: string[]): string[] => {
  if (brandFamilies.length === 0) return [];
  const allowed = new Set(brandFamilies.map((family) => family.toLowerCase()));
  return families.filter((family) => !allowed.has(family.toLowerCase())).slice(0, 6);
};
