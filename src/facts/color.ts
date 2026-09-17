import type { Brand, DomSnapshot, ElementRecord, Measurements } from "../types.js";

export interface RgbaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

export const parseColor = (input: string | undefined): RgbaColor | null => {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (value === "transparent") return null;

  if (value.startsWith("#")) {
    const hex = value.slice(1);
    if (![3, 4, 6, 8].includes(hex.length) || !/^[0-9a-f]+$/.test(hex)) return null;
    const expanded = hex.length <= 4 ? [...hex].map((digit) => `${digit}${digit}`).join("") : hex;
    const alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1;
    if (alpha < 0.05) return null;
    return {
      r: Number.parseInt(expanded.slice(0, 2), 16),
      g: Number.parseInt(expanded.slice(2, 4), 16),
      b: Number.parseInt(expanded.slice(4, 6), 16),
      a: alpha,
    };
  }

  const match = value.match(/^rgba?\((.+)\)$/);
  if (!match?.[1]) return null;
  const parts = match[1].replace(/\s*\/\s*/, ",").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (part: string): number =>
    part.endsWith("%") ? clampByte(Number.parseFloat(part) * 2.55) : clampByte(Number.parseFloat(part));
  const alphaPart = parts[3];
  const alpha = alphaPart === undefined
    ? 1
    : alphaPart.endsWith("%")
      ? Number.parseFloat(alphaPart) / 100
      : Number.parseFloat(alphaPart);
  if (![...parts.slice(0, 3), String(alpha)].every((part) => Number.isFinite(Number.parseFloat(part)))) return null;
  if (alpha < 0.05) return null;
  return { r: channel(parts[0]!), g: channel(parts[1]!), b: channel(parts[2]!), a: Math.min(1, alpha) };
};

export const colorToHex = (color: RgbaColor): string =>
  `#${[color.r, color.g, color.b].map((channel) => clampByte(channel).toString(16).padStart(2, "0")).join("")}`;

const linearChannel = (channel: number): number => {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

export const relativeLuminance = (color: RgbaColor): number =>
  0.2126 * linearChannel(color.r) + 0.7152 * linearChannel(color.g) + 0.0722 * linearChannel(color.b);

export const contrastRatio = (foreground: RgbaColor | string, background: RgbaColor | string): number => {
  const foregroundColor = typeof foreground === "string" ? parseColor(foreground) : foreground;
  const backgroundColor = typeof background === "string" ? parseColor(background) : background;
  if (!foregroundColor || !backgroundColor) return 1;
  const foregroundLuminance = relativeLuminance(foregroundColor);
  const backgroundLuminance = relativeLuminance(backgroundColor);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
};

const colorDistance = (left: RgbaColor, right: RgbaColor): number =>
  Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);

const contains = (outer: ElementRecord["rect"], inner: ElementRecord["rect"]): boolean =>
  outer.x <= inner.x + 0.5 && outer.y <= inner.y + 0.5 &&
  outer.x + outer.width >= inner.x + inner.width - 0.5 &&
  outer.y + outer.height >= inner.y + inner.height - 0.5;

const opaqueBackground = (element: ElementRecord, elements: ElementRecord[]): RgbaColor => {
  const candidates = elements
    .filter((candidate) => contains(candidate.rect, element.rect))
    .map((candidate) => ({
      color: parseColor(candidate.styles["background-color"]),
      area: candidate.rect.width * candidate.rect.height,
    }))
    .filter((candidate): candidate is { color: RgbaColor; area: number } => candidate.color !== null && candidate.color.a >= 0.95)
    .sort((left, right) => left.area - right.area);
  return candidates[0]?.color ?? { r: 255, g: 255, b: 255, a: 1 };
};

const composite = (foreground: RgbaColor, background: RgbaColor): RgbaColor => ({
  r: foreground.r * foreground.a + background.r * (1 - foreground.a),
  g: foreground.g * foreground.a + background.g * (1 - foreground.a),
  b: foreground.b * foreground.a + background.b * (1 - foreground.a),
  a: 1,
});

const px = (value: string | undefined): number => Number.parseFloat(value ?? "0") || 0;

export const compileColorMeasurements = (
  snapshot: DomSnapshot,
  brand: Brand,
): Pick<Measurements, "colorsUsed" | "offTokenRatio" | "contrastFailures"> => {
  const colorProperties = [
    "color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
  ];
  const usage = new Map<string, { count: number; selectors: string[]; color: RgbaColor }>();
  for (const element of snapshot.elements) {
    for (const property of colorProperties) {
      const parsed = parseColor(element.styles[property]);
      if (!parsed) continue;
      const hex = colorToHex(parsed);
      const current = usage.get(hex) ?? { count: 0, selectors: [], color: parsed };
      current.count += 1;
      if (current.selectors.length < 3 && !current.selectors.includes(element.selector)) current.selectors.push(element.selector);
      usage.set(hex, current);
    }
  }

  const tokens = brand.palette.flatMap((entry) => {
    const color = parseColor(entry.hex);
    return color ? [{ token: entry.token, color }] : [];
  });
  const colorsUsed = [...usage.entries()].map(([hex, used]) => {
    let onToken: string | null = null;
    if (brand.palette.length === 0) onToken = hex;
    else if (hex === "#ffffff" || hex === "#000000") onToken = hex;
    else {
      const nearest = tokens
        .map((token) => ({ ...token, distance: colorDistance(used.color, token.color) }))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearest && nearest.distance <= 12) onToken = nearest.token;
    }
    return { hex, count: used.count, onToken, selectors: used.selectors };
  }).sort((left, right) => right.count - left.count || left.hex.localeCompare(right.hex));

  const totalUses = colorsUsed.reduce((sum, color) => sum + color.count, 0);
  const offTokenUses = colorsUsed.filter((color) => color.onToken === null).reduce((sum, color) => sum + color.count, 0);

  const contrastFailures: Measurements["contrastFailures"] = [];
  for (const element of snapshot.elements) {
    if (!element.text.trim()) continue;
    const foreground = parseColor(element.styles.color);
    if (!foreground) continue;
    const background = opaqueBackground(element, snapshot.elements);
    const effectiveForeground = foreground.a < 1 ? composite(foreground, background) : foreground;
    const ratio = contrastRatio(effectiveForeground, background);
    const fontSize = px(element.styles["font-size"]);
    const fontWeightValue = element.styles["font-weight"]?.toLowerCase() ?? "400";
    const fontWeight = fontWeightValue === "bold" ? 700 : Number.parseInt(fontWeightValue, 10) || 400;
    const required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
    if (ratio + 0.0001 < required) {
      contrastFailures.push({
        selector: element.selector,
        ratio: Number(ratio.toFixed(2)),
        required,
        fg: colorToHex(effectiveForeground),
        bg: colorToHex(background),
      });
    }
  }

  return {
    colorsUsed,
    offTokenRatio: totalUses === 0 ? 0 : offTokenUses / totalUses,
    contrastFailures,
  };
};
