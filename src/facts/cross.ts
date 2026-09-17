import {
  bucketPalette,
  bucketVariety,
  type CrossScreenFacts,
  type ScreenAnalysis,
} from "../types.js";
import { colorToHex, parseColor } from "./color.js";
import { normalizeRadius } from "./shape.js";

const roundedHeight = (height: number): number => Math.round(height / 4) * 4;

export const compileCrossScreen = (screens: ScreenAnalysis[]): CrossScreenFacts => {
  const buttonSignatures = new Set<string>();
  for (const screen of screens) {
    for (const element of screen.snapshot.elements) {
      if (!element.interactive || (element.tagName !== "button" && element.tagName !== "a")) continue;
      const background = parseColor(element.styles["background-color"]);
      if (!background) continue;
      const radius = normalizeRadius(element.styles["border-radius"]) ?? 0;
      buttonSignatures.add(`${colorToHex(background)}|${radius}|${roundedHeight(element.rect.height)}`);
    }
  }

  const radii = new Set(screens.flatMap((screen) => screen.measurements.radiiPx));
  const palette = new Set(screens.flatMap((screen) => screen.measurements.colorsUsed
    .map((color) => color.hex)
    .filter((hex) => hex !== "#ffffff" && hex !== "#000000")));
  const fonts = new Set(screens.flatMap((screen) => screen.measurements.fontFamilies.map((family) => family.toLowerCase())));

  return {
    button_signatures: bucketVariety(buttonSignatures.size),
    radii_union: bucketVariety(radii.size),
    palette_union: bucketPalette(palette.size),
    font_family_union: bucketVariety(fonts.size),
  };
};
