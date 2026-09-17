import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractBrand } from "../src/init/brand.js";
import { BrandSchema } from "../src/types.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "design-gate-brand-"));
}

function write(cwd: string, relative: string, contents: string): void {
  const file = path.join(cwd, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents, "utf8");
}

describe("brand extraction", () => {
  it("extracts and normalizes local design signals without executing project code", async () => {
    const cwd = await tempProject();
    write(cwd, "package.json", JSON.stringify({ name: "signal-studio" }));
    write(cwd, "tailwind.config.ts", `
      export default {
        darkMode: "class",
        theme: { extend: {
          colors: { brand: { 500: "#abc" }, primary: "#112233" },
          fontFamily: { heading: ["Sora", "sans-serif"] },
          borderRadius: { card: "0.75rem" },
          spacing: { 1: "0.25rem", 2: "0.5rem", 4: "1rem" }
        } }
      };
    `);
    write(cwd, "src/theme.css", `
      @theme {
        --color-accent: hsl(200, 100%, 50%);
        --font-body: "Inter", sans-serif;
        --radius-pill: 24px;
        --spacing-layout: 2rem;
      }
      :root {
        --surface: rgb(255, 255, 255);
        --font-family-code: "JetBrains Mono", monospace;
        --space-tight: 8px;
      }
      @font-face { font-family: "Local Sans"; src: url(local.woff2); }
      @media (prefers-color-scheme: dark) { body { color: white; } }
    `);
    write(cwd, "tokens.json", JSON.stringify({
      color: {
        danger: { $type: "color", $value: "#dc2626" },
        warning: { value: "rgb(245, 158, 11)" },
      },
    }));
    write(cwd, "DESIGN.md", `
# Palette
- Background: #0b0d0c
- Muted: #64748b

# Typography
- Font: "Newsreader", serif

# Voice & Tone
- Clear, warm / direct

# Never use
- synergy
- magical
    `);
    write(cwd, "index.html", `
      <link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">
    `);

    const brand = await extractBrand(cwd);
    expect(() => BrandSchema.parse(brand)).not.toThrow();
    expect(brand.name).toBe("signal-studio");
    expect(brand.palette).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: "brand-500", hex: "#aabbcc", role: "primary" }),
      expect.objectContaining({ token: "primary", hex: "#112233", role: "primary" }),
      expect.objectContaining({ token: "accent", hex: "#00aaff", role: "accent" }),
      expect.objectContaining({ token: "surface", hex: "#ffffff", role: "surface" }),
      expect.objectContaining({ token: "color.danger", hex: "#dc2626", role: "danger" }),
    ]));
    expect(brand.type.map((entry) => entry.family)).toEqual(expect.arrayContaining([
      "Sora", "Inter", "JetBrains Mono", "Local Sans", "Newsreader", "Roboto Mono",
    ]));
    expect(brand.voice).toEqual(expect.arrayContaining(["Clear", "warm", "direct"]));
    expect(brand.forbidden).toEqual(expect.arrayContaining(["synergy", "magical"]));
    expect(brand.darkMode).toBe(true);
    expect(brand.spacing.base).toBe(4);
    expect(brand.sources).toEqual(expect.arrayContaining([
      "tailwind.config.ts", "src/theme.css", "tokens.json", "DESIGN.md", "index.html",
    ]));
  });
});
