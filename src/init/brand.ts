import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { BrandSchema, type Brand, type PALETTE_ROLES } from "../types.js";

type PaletteRole = (typeof PALETTE_ROLES)[number];
type TypeRole = NonNullable<Brand["type"][number]["role"]>;

interface PaletteCandidate {
  token: string;
  hex: string;
}

interface ExtractedValues {
  palette: PaletteCandidate[];
  fonts: string[];
  radius: number[];
  spacing: number[];
  voice: string[];
  forbidden: string[];
  darkMode: boolean;
}

const EMPTY_VALUES = (): ExtractedValues => ({
  palette: [],
  fonts: [],
  radius: [],
  spacing: [],
  voice: [],
  forbidden: [],
  darkMode: false,
});

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "build"]);

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .replace(/^--/, "")
    .replace(/^color-/, "")
    .replace(/[._\s]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function byteHex(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

function normalizeHex(value: string): string | null {
  const input = value.trim().toLowerCase();
  const short = input.match(/^#([0-9a-f]{3,4})$/i)?.[1];
  if (short) return `#${short.slice(0, 3).split("").map((part) => part + part).join("")}`;
  const long = input.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/i)?.[1];
  return long ? `#${long}` : null;
}

function rgbToHex(value: string): string | null {
  const match = value.match(/^rgba?\(\s*([^)]*)\)$/i);
  if (!match?.[1]) return null;
  const parts = match[1].replace(/\s*\/\s*[^,\s]+$/, "").split(/[\s,]+/).filter(Boolean).slice(0, 3);
  if (parts.length !== 3) return null;
  const bytes = parts.map((part) => part.endsWith("%") ? Number.parseFloat(part) * 2.55 : Number.parseFloat(part));
  if (bytes.some((part) => !Number.isFinite(part))) return null;
  return `#${bytes.map(byteHex).join("")}`;
}

function hslToHex(value: string): string | null {
  const match = value.match(/^hsla?\(\s*([^)]*)\)$/i);
  if (!match?.[1]) return null;
  const parts = match[1].replace(/\s*\/\s*[^,\s]+$/, "").split(/[\s,]+/).filter(Boolean).slice(0, 3);
  if (parts.length !== 3) return null;
  const hue = ((Number.parseFloat(parts[0] ?? "") % 360) + 360) % 360;
  const saturation = Number.parseFloat(parts[1] ?? "") / 100;
  const lightness = Number.parseFloat(parts[2] ?? "") / 100;
  if (![hue, saturation, lightness].every(Number.isFinite)) return null;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const offset = lightness - chroma / 2;
  const [red, green, blue] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return `#${byteHex((red + offset) * 255)}${byteHex((green + offset) * 255)}${byteHex((blue + offset) * 255)}`;
}

function colorToHex(value: string): string | null {
  return normalizeHex(value) ?? rgbToHex(value) ?? hslToHex(value);
}

function dimensionToPx(value: string): number | null {
  const match = value.trim().match(/^(-?\d*\.?\d+)\s*(px|rem)$/i);
  if (!match?.[1] || !match[2]) return null;
  const number = Number.parseFloat(match[1]);
  if (!Number.isFinite(number)) return null;
  return match[2].toLowerCase() === "rem" ? number * 16 : number;
}

function inferPaletteRole(token: string): PaletteRole | undefined {
  const lower = token.toLowerCase();
  if (/(?:^|[-_.])(danger|error)(?:$|[-_.])/.test(lower)) return "danger";
  if (/(?:^|[-_.])primary(?:$|[-_.])/.test(lower)) return "primary";
  if (/(?:^|[-_.])(accent|secondary)(?:$|[-_.])/.test(lower)) return "accent";
  if (/(?:^|[-_.])(background|bg)(?:$|[-_.])/.test(lower)) return "background";
  if (/(?:^|[-_.])surface(?:$|[-_.])/.test(lower)) return "surface";
  if (/(?:^|[-_.])(text|foreground|fg)(?:$|[-_.])/.test(lower)) return "text";
  if (/(?:^|[-_.])muted(?:$|[-_.])/.test(lower)) return "muted";
  if (/(?:^|[-_.])border(?:$|[-_.])/.test(lower)) return "border";
  if (/(?:^|[-_.])success(?:$|[-_.])/.test(lower)) return "success";
  if (/(?:^|[-_.])warning(?:$|[-_.])/.test(lower)) return "warning";
  if (/(?:^|[-_.])(brand)(?:$|[-_.])/.test(lower)) return "primary";
  return undefined;
}

function inferTypeRole(token: string): TypeRole {
  const lower = token.toLowerCase();
  if (/display|heading|title/.test(lower)) return "display";
  if (/mono|code/.test(lower)) return "mono";
  if (/body|sans/.test(lower)) return "body";
  return "ui";
}

function firstFamily(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\?['"]/g, "")
    .trim();
  if (!cleaned || /^(var\(|theme\(|sans-serif$|serif$|monospace$)/i.test(cleaned)) return null;
  return cleaned;
}

function balancedBlock(source: string, openingBrace: number): string | null {
  let depth = 0;
  let quote: string | null = null;
  for (let index = openingBrace; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openingBrace + 1, index);
    }
  }
  return null;
}

function namedBlocks(source: string, name: string): string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`(?:['"]${name}['"]|\\b${name})\\s*:\\s*\\{`, "g");
  for (const match of source.matchAll(pattern)) {
    const brace = (match.index ?? 0) + match[0].lastIndexOf("{");
    const block = balancedBlock(source, brace);
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

interface ObjectEntry {
  key: string;
  value: string;
  nested: boolean;
}

function looseObjectEntries(block: string): ObjectEntry[] {
  const entries: ObjectEntry[] = [];
  let index = 0;
  while (index < block.length) {
    while (index < block.length && /[\s,]/.test(block[index] ?? "")) index += 1;
    if (index >= block.length) break;
    let key = "";
    const quote = block[index];
    if (quote === "'" || quote === '"') {
      index += 1;
      const start = index;
      while (index < block.length && (block[index] !== quote || block[index - 1] === "\\")) index += 1;
      key = block.slice(start, index);
      index += 1;
    } else {
      const match = block.slice(index).match(/^([\w-]+)/);
      if (!match?.[1]) {
        index += 1;
        continue;
      }
      key = match[1];
      index += match[1].length;
    }
    while (index < block.length && /\s/.test(block[index] ?? "")) index += 1;
    if (block[index] !== ":") continue;
    index += 1;
    while (index < block.length && /\s/.test(block[index] ?? "")) index += 1;
    if (block[index] === "{") {
      const nested = balancedBlock(block, index);
      if (nested === null) break;
      entries.push({ key, value: nested, nested: true });
      index += nested.length + 2;
      continue;
    }
    const start = index;
    let innerQuote: string | null = null;
    let brackets = 0;
    while (index < block.length) {
      const char = block[index];
      if (innerQuote) {
        if (char === innerQuote && block[index - 1] !== "\\") innerQuote = null;
      } else if (char === "'" || char === '"' || char === "`") {
        innerQuote = char;
      } else if (char === "[") {
        brackets += 1;
      } else if (char === "]") {
        brackets -= 1;
      } else if (char === "," && brackets === 0) {
        break;
      }
      index += 1;
    }
    entries.push({ key, value: block.slice(start, index).trim(), nested: false });
    index += 1;
  }
  return entries;
}

function flattenLooseObject(block: string, prefix = ""): ObjectEntry[] {
  const output: ObjectEntry[] = [];
  for (const entry of looseObjectEntries(block)) {
    const key = prefix ? `${prefix}-${entry.key}` : entry.key;
    if (entry.nested) output.push(...flattenLooseObject(entry.value, key));
    else output.push({ ...entry, key });
  }
  return output;
}

function quotedValue(value: string): string {
  return value.trim().replace(/^[`'"]|[`'"]$/g, "");
}

function extractTailwind(source: string): ExtractedValues {
  const output = EMPTY_VALUES();
  for (const block of namedBlocks(source, "colors")) {
    for (const entry of flattenLooseObject(block)) {
      const hex = colorToHex(quotedValue(entry.value));
      if (hex) output.palette.push({ token: normalizeToken(entry.key), hex });
    }
  }
  for (const block of namedBlocks(source, "fontFamily")) {
    for (const entry of looseObjectEntries(block)) {
      const quoted = entry.value.match(/['"]([^'"]+)['"]/)?.[1] ?? entry.value;
      const family = firstFamily(quoted);
      if (family) output.fonts.push(`${entry.key}\0${family}`);
    }
  }
  for (const [field, target] of [["borderRadius", output.radius], ["spacing", output.spacing]] as const) {
    for (const block of namedBlocks(source, field)) {
      for (const entry of flattenLooseObject(block)) {
        const value = dimensionToPx(quotedValue(entry.value));
        if (value !== null && value >= 0) target.push(value);
      }
    }
  }
  output.darkMode = /\bdarkMode\s*:/.test(source);
  return output;
}

function customProperties(block: string): Array<{ name: string; value: string }> {
  return [...block.matchAll(/(--[\w-]+)\s*:\s*([^;}{]+?)\s*(?:;|$)/g)].flatMap((match) =>
    match[1] && match[2] ? [{ name: match[1], value: match[2].trim() }] : [],
  );
}

function cssBlocks(source: string, selector: RegExp): string[] {
  const blocks: string[] = [];
  for (const match of source.matchAll(selector)) {
    const brace = (match.index ?? 0) + match[0].lastIndexOf("{");
    const block = balancedBlock(source, brace);
    if (block !== null) blocks.push(block);
  }
  return blocks;
}

function googleFontFamilies(source: string): string[] {
  const families: string[] = [];
  for (const match of source.matchAll(/fonts\.googleapis\.com\/css2?[^'"\s)>]*/gi)) {
    const url = match[0].replace(/&amp;/g, "&");
    for (const familyMatch of url.matchAll(/[?&]family=([^&]+)/g)) {
      const raw = familyMatch[1]?.split(":")[0];
      if (raw) families.push(decodeURIComponent(raw.replace(/\+/g, " ")));
    }
  }
  return families;
}

function extractCss(source: string): ExtractedValues {
  const output = EMPTY_VALUES();
  for (const block of cssBlocks(source, /@theme\s*\{/g)) {
    for (const property of customProperties(block)) {
      if (property.name.startsWith("--color-")) {
        const hex = colorToHex(property.value);
        if (hex) output.palette.push({ token: normalizeToken(property.name), hex });
      }
      if (/^--(?:font|font-family)-/.test(property.name)) {
        const family = firstFamily(property.value);
        if (family) output.fonts.push(`${normalizeToken(property.name)}\0${family}`);
      }
      const dimension = dimensionToPx(property.value);
      if (dimension !== null && /^--radius/.test(property.name)) output.radius.push(dimension);
      if (dimension !== null && /^--(?:spacing|space)-/.test(property.name)) output.spacing.push(dimension);
    }
  }
  for (const block of cssBlocks(source, /:root\s*\{/g)) {
    for (const property of customProperties(block)) {
      const hex = colorToHex(property.value);
      if (hex) output.palette.push({ token: normalizeToken(property.name), hex });
      if (/^--(?:font|font-family)(?:-|$)/.test(property.name)) {
        const family = firstFamily(property.value);
        if (family) output.fonts.push(`${normalizeToken(property.name)}\0${family}`);
      }
      const dimension = dimensionToPx(property.value);
      if (dimension !== null && /^--radius/.test(property.name)) output.radius.push(dimension);
      if (dimension !== null && /^--(?:spacing|space)-/.test(property.name)) output.spacing.push(dimension);
    }
  }
  for (const match of source.matchAll(/@font-face\s*\{[\s\S]*?font-family\s*:\s*([^;}]+)[;}][\s\S]*?\}/gi)) {
    const family = match[1] ? firstFamily(match[1]) : null;
    if (family) output.fonts.push(`font-face\0${family}`);
  }
  for (const family of googleFontFamilies(source)) output.fonts.push(`google-font\0${family}`);
  output.darkMode = /prefers-color-scheme\s*:\s*dark/i.test(source);
  return output;
}

function extractTokenJson(source: string): ExtractedValues {
  const output = EMPTY_VALUES();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return output;
  }
  const visit = (value: unknown, tokens: string[], inheritedType?: string): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    const ownType = typeof record.$type === "string" ? record.$type : inheritedType;
    const raw = record.$value ?? record.value;
    if (typeof raw === "string" && (ownType === undefined || ownType === "color")) {
      const hex = colorToHex(raw);
      if (hex && tokens.length > 0) output.palette.push({ token: tokens.join("."), hex });
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === "$value" || key === "value" || key === "$type" || key === "type" || key.startsWith("$")) continue;
      visit(child, [...tokens, key], ownType);
    }
  };
  visit(parsed, []);
  return output;
}

function cleanListValue(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^\*\*([^*]+)\*\*\s*:??\s*/, "$1: ")
    .trim();
}

function proseItems(line: string): string[] {
  return cleanListValue(line)
    .replace(/^[^:]+:\s*/, "")
    .split(/\s*(?:,|\/|\s[-–—]\s)\s*/)
    .map((part) => part.trim().replace(/[.;]+$/, ""))
    .filter((part) => /^[\p{L}][\p{L}\s-]{1,40}$/u.test(part));
}

function extractDesignDoc(source: string): ExtractedValues {
  const output = EMPTY_VALUES();
  const lines = source.split(/\r?\n/);
  let section: "voice" | "forbidden" | null = null;
  let precedingLabel = "color";
  for (const line of lines) {
    const heading = line.match(/^\s*#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    if (heading) {
      section = /voice|tone|personality/i.test(heading) ? "voice"
        : /never|avoid|forbidden|don't/i.test(heading) ? "forbidden"
          : null;
      precedingLabel = heading;
      continue;
    }
    const sameLineLabel = line.match(/(?:^|[-*]\s+|\|\s*)(?:\*\*)?([\w][\w\s-]{0,40}?)(?:\*\*)?\s*:\s*(#[0-9a-f]{3,8})/i);
    const colors = [...line.matchAll(/#[0-9a-f]{3,8}\b/gi)];
    for (const match of colors) {
      const hex = colorToHex(match[0]);
      if (hex) output.palette.push({ token: normalizeToken(sameLineLabel?.[1] ?? precedingLabel), hex });
    }
    const labelOnly = cleanListValue(line).match(/^([\w][\w\s-]{1,40}):\s*$/)?.[1];
    if (labelOnly) precedingLabel = labelOnly;
    if (/\b(font|typeface)\b/i.test(line)) {
      const value = cleanListValue(line).match(/(?:font(?:-family)?|typeface)[^:]*:\s*(.+)$/i)?.[1];
      const family = value ? firstFamily(value.replace(/[*`]/g, "")) : null;
      if (family) output.fonts.push(`document-font\0${family}`);
    }
    if (section === "voice" && line.trim()) output.voice.push(...proseItems(line));
    if (section === "forbidden" && line.trim()) output.forbidden.push(...proseItems(line));
  }
  return output;
}

function listCssFiles(cwd: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    if (output.length >= 30) return;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (output.length >= 30) break;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) visit(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".css")) output.push(fullPath);
    }
  };
  try {
    output.push(...readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".css"))
      .map((entry) => path.join(cwd, entry.name))
      .sort());
  } catch {
    return output;
  }
  for (const directory of ["app", "src", "styles"]) {
    if (output.length >= 30) break;
    visit(path.join(cwd, directory));
  }
  return output;
}

function listTokenFiles(cwd: string): string[] {
  const direct = [path.join(cwd, "tokens.json"), path.join(cwd, "design-tokens.json")];
  const tokenDir = path.join(cwd, "tokens");
  if (existsSync(tokenDir)) {
    try {
      direct.push(...readdirSync(tokenDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => path.join(tokenDir, entry.name)));
    } catch {
      // Ignore unreadable optional token directories.
    }
  }
  return direct.filter((file) => existsSync(file)).sort();
}

function mergeValues(target: ExtractedValues, input: ExtractedValues): boolean {
  const used = input.palette.length > 0 || input.fonts.length > 0 || input.radius.length > 0 || input.spacing.length > 0
    || input.voice.length > 0 || input.forbidden.length > 0 || input.darkMode;
  target.palette.push(...input.palette);
  target.fonts.push(...input.fonts);
  target.radius.push(...input.radius);
  target.spacing.push(...input.spacing);
  target.voice.push(...input.voice);
  target.forbidden.push(...input.forbidden);
  target.darkMode ||= input.darkMode;
  return used;
}

function uniqueStrings(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleaned = value.trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
    if (output.length >= limit) break;
  }
  return output;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isFinite(value) && value >= 0).map((value) => Number(value.toFixed(4))))].sort((a, b) => a - b);
}

function spacingBase(scale: number[]): number {
  const positive = scale.filter((value) => value === 4 || value === 8);
  for (const candidate of positive) {
    if (scale.filter((value) => value > 0).every((value) => Math.abs(value / candidate - Math.round(value / candidate)) < 1e-6)) return candidate;
  }
  return 4;
}

function packageName(cwd: string): string {
  const packageSource = readText(path.join(cwd, "package.json"));
  if (packageSource) {
    try {
      const parsed = JSON.parse(packageSource) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.trim()) return parsed.name.trim();
    } catch {
      // Fall through to the directory name.
    }
  }
  return path.basename(path.resolve(cwd)) || "Untitled";
}

export async function extractBrand(cwd: string): Promise<Brand> {
  const values = EMPTY_VALUES();
  const sources: string[] = [];
  const consume = (file: string, extracted: ExtractedValues): void => {
    if (mergeValues(values, extracted)) sources.push(path.relative(cwd, file).split(path.sep).join("/"));
  };

  for (const name of ["tailwind.config.js", "tailwind.config.cjs", "tailwind.config.mjs", "tailwind.config.ts"]) {
    const file = path.join(cwd, name);
    const source = readText(file);
    if (source !== null) consume(file, extractTailwind(source));
  }
  for (const file of listCssFiles(cwd)) {
    const source = readText(file);
    if (source !== null) consume(file, extractCss(source));
  }
  for (const file of listTokenFiles(cwd)) {
    const source = readText(file);
    if (source !== null) consume(file, extractTokenJson(source));
  }
  for (const name of ["DESIGN.md", "PRODUCT.md", "BRAND.md"]) {
    const file = path.join(cwd, name);
    const source = readText(file);
    if (source !== null) consume(file, extractDesignDoc(source));
  }
  for (const name of ["index.html", "app/layout.tsx", "src/app.html"]) {
    const file = path.join(cwd, name);
    const source = readText(file);
    if (source === null) continue;
    const extracted = EMPTY_VALUES();
    for (const family of googleFontFamilies(source)) extracted.fonts.push(`google-font\0${family}`);
    consume(file, extracted);
  }

  const seenColors = new Set<string>();
  const palette: Brand["palette"] = [];
  for (const candidate of values.palette) {
    if (seenColors.has(candidate.hex)) continue;
    seenColors.add(candidate.hex);
    const token = candidate.token || "color";
    const role = inferPaletteRole(token);
    palette.push({ token, hex: candidate.hex, ...(role ? { role } : {}) });
    if (palette.length >= 24) break;
  }

  const type: Brand["type"] = [];
  const seenFonts = new Set<string>();
  for (const value of values.fonts) {
    const [token = "", family = value] = value.split("\0");
    const key = family.toLowerCase();
    if (!family || seenFonts.has(key)) continue;
    seenFonts.add(key);
    type.push({ family, role: inferTypeRole(`${token} ${family}`) });
    if (type.length >= 6) break;
  }

  const radiusScale = uniqueNumbers(values.radius);
  const spacingScale = uniqueNumbers(values.spacing);
  return BrandSchema.parse({
    name: packageName(cwd),
    intent: "conventional",
    palette,
    type,
    radius: { ...(radiusScale.find((value) => value > 0) !== undefined ? { base: radiusScale.find((value) => value > 0) } : {}), scale: radiusScale },
    spacing: { base: spacingBase(spacingScale), scale: spacingScale },
    voice: uniqueStrings(values.voice, 6),
    forbidden: uniqueStrings(values.forbidden, 10),
    darkMode: values.darkMode,
    sources: [...new Set(sources)],
  });
}
