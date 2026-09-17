import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BrandSchema, type Brand, type DomSnapshot, type Viewport } from "../src/types.js";
import { captureScreen } from "../src/capture/playwright.js";

export const desktop: Viewport = { name: "desktop", width: 1440, height: 900 };
export const mobile: Viewport = { name: "mobile", width: 390, height: 844 };

export const fixturePath = (...parts: string[]): string => resolve(process.cwd(), "fixtures", ...parts);

export const loadBrand = async (fixture: "generic-saas" | "on-brand"): Promise<Brand> =>
  BrandSchema.parse(JSON.parse(await readFile(fixturePath(fixture, "brand.json"), "utf8")));

export const captureFixtureScreens = async (
  fixture: "generic-saas" | "on-brand",
  outDir: string,
): Promise<DomSnapshot[]> => {
  const screens: DomSnapshot[] = [];
  for (const pageName of ["index", "pricing"] as const) {
    for (const viewport of [desktop, mobile]) {
      screens.push(await captureScreen({
        url: pathToFileURL(fixturePath(fixture, `${pageName}.html`)).href,
        route: `/${pageName}`,
        viewport,
        outDir,
        shotName: `${fixture}-${pageName}-${viewport.name}`,
      }));
    }
  }
  return screens;
};
