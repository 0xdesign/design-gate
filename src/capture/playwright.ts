import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { AxeBuilder } from "@axe-core/playwright";
import { chromium, type Browser } from "playwright";
import type { Config, DomSnapshot, ElementRecord, Viewport } from "../types.js";

const RETRY_DELAY_MS = 500;
const CAPTURE_TIMEOUT_MS = 15_000;

/** A dev-server command that starts with `design-gate` runs this same CLI, even when it is not on PATH. */
const resolveServerCommand = (command: string): string => {
  const entry = process.argv[1];
  if (!entry || !/^design-gate(\s|$)/.test(command.trim())) return command;
  return command.trim().replace(/^design-gate/, `${JSON.stringify(process.execPath)} ${JSON.stringify(entry)}`);
};

export class DevServerUnreachableError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`Dev server is unreachable at ${url}`);
    this.name = "DevServerUnreachableError";
    this.url = url;
  }
}

const delay = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const isReachable = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5_000) });
    return response.status < 500;
  } catch {
    return false;
  }
};

const retryReachable = async (url: string, attempts: number): Promise<boolean> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isReachable(url)) return true;
    if (attempt + 1 < attempts) await delay(RETRY_DELAY_MS);
  }
  return false;
};

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      finish();
    }, 2_000).unref();
  });
};

export const ensureDevServer = async (
  config: Config,
  opts: { cwd?: string; log?: (message: string) => void } = {},
): Promise<{ url: string; started: boolean; stop: () => Promise<void> }> => {
  const { url, autoStart, command, readyTimeoutMs } = config.devServer;
  if (await retryReachable(url, 3)) {
    return { url, started: false, stop: async () => undefined };
  }

  if (!autoStart || !command) throw new DevServerUnreachableError(url);

  opts.log?.(`Starting dev server: ${command}`);
  const child = spawn(resolveServerCommand(command), {
    shell: true,
    detached: false,
    env: process.env,
    cwd: opts.cwd ?? process.cwd(),
    stdio: "ignore",
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < readyTimeoutMs) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    if (await isReachable(url)) {
      return { url, started: true, stop: async () => await stopChild(child) };
    }
    await delay(RETRY_DELAY_MS);
  }

  await stopChild(child);
  throw new DevServerUnreachableError(url);
};

const sha256File = async (path: string): Promise<string> =>
  createHash("sha256").update(await readFile(path)).digest("hex");

const destinationUrl = (url: string, route: string): string =>
  url.startsWith("file://") && url.toLowerCase().endsWith(".html") ? url : `${url}${route}`;

const launchChromium = async (): Promise<Browser> => {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return await chromium.launch({ headless: true, args: ["--single-process"] });
  }
};

export const captureScreen = async (args: {
  url: string;
  route: string;
  viewport: Viewport;
  outDir: string;
  shotName: string;
  browser?: Browser;
}): Promise<DomSnapshot> => {
  const ownedBrowser = args.browser ?? (await launchChromium());
  const context = await ownedBrowser.newContext({
    viewport: { width: args.viewport.width, height: args.viewport.height },
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await page.goto(destinationUrl(args.url, args.route), {
      waitUntil: "load",
      timeout: CAPTURE_TIMEOUT_MS,
    });
    await page.waitForLoadState("networkidle", { timeout: CAPTURE_TIMEOUT_MS }).catch(() => undefined);
    await page.evaluate(async () => await document.fonts.ready);

    const captured = await page.evaluate(() => {
      const ownText = (element: Element): string =>
        Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? "")
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

      const selectorFor = (element: Element): string => {
        const testId = element.getAttribute("data-testid");
        if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
        if (element.id) return `#${CSS.escape(element.id)}`;

        const segments: string[] = [];
        let current: Element | null = element;
        while (current && current !== document.documentElement && segments.length < 3) {
          let segment = current.tagName.toLowerCase();
          const classes = Array.from(current.classList).filter(Boolean).slice(0, 2);
          if (classes.length > 0) segment += classes.map((name) => `.${CSS.escape(name)}`).join("");
          const parent: Element | null = current.parentElement;
          if (parent) {
            const sameTag = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
            if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
          }
          segments.unshift(segment);
          if (["MAIN", "NAV", "HEADER", "FOOTER", "ASIDE", "FORM"].includes(current.tagName)) break;
          current = parent;
        }
        return segments.join(" > ");
      };

      const implicitRole = (element: Element): string | undefined => {
        const explicit = element.getAttribute("role");
        if (explicit) return explicit;
        const tag = element.tagName.toLowerCase();
        if (tag === "a" && element.hasAttribute("href")) return "link";
        if (tag === "button") return "button";
        if (tag === "textarea") return "textbox";
        if (tag === "select") return "combobox";
        if (tag === "input") {
          const type = (element.getAttribute("type") ?? "text").toLowerCase();
          if (["button", "submit", "reset", "image"].includes(type)) return "button";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          return "textbox";
        }
        return undefined;
      };

      const interactiveSelector = "a[href],button,input,select,textarea,[role=button],[tabindex]";
      const isVisible = (element: Element): boolean => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" &&
          style.display !== "none" && Number.parseFloat(style.opacity || "1") > 0;
      };

      const all = [document.body, ...Array.from(document.querySelectorAll("body *"))].filter(isVisible);
      const prioritized = all
        .map((element, documentIndex) => {
          const text = ownText(element);
          const priority = element.matches(interactiveSelector)
            ? 0
            : /^H[1-6]$/.test(element.tagName)
              ? 1
              : text.length >= 3
                ? 2
                : 3;
          return { element, documentIndex, priority, text };
        })
        .sort((left, right) => left.priority - right.priority || left.documentIndex - right.documentIndex)
        .slice(0, 400);

      const styleProperties = [
        "color", "background-color", "font-family", "font-size", "font-weight", "line-height",
        "letter-spacing", "text-transform", "padding-top", "padding-right", "padding-bottom", "padding-left",
        "margin-top", "margin-right", "margin-bottom", "margin-left", "gap", "row-gap", "column-gap",
        "border-radius", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
        "box-shadow", "transition-duration", "transition-property", "animation-duration", "animation-name",
        "outline-style", "outline-width", "cursor", "display", "position", "width", "height",
      ];

      const elements = prioritized.map(({ element, text }) => {
        const computed = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const styles = Object.fromEntries(styleProperties.map((property) => [property, computed.getPropertyValue(property)]));
        const tabIndex = (element as HTMLElement).tabIndex;
        const focusable = tabIndex >= 0 && !element.hasAttribute("disabled");
        return {
          selector: selectorFor(element),
          tagName: element.tagName.toLowerCase(),
          rect: { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
          styles,
          role: implicitRole(element),
          focusable,
          interactive: element.matches(interactiveSelector),
          text: text.slice(0, 200),
          textContent: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 80) || undefined,
        };
      });

      const parseDuration = (value: string): number[] =>
        value.split(",").map((part) => {
          const trimmed = part.trim();
          const amount = Number.parseFloat(trimmed);
          if (!Number.isFinite(amount)) return 0;
          return trimmed.endsWith("ms") ? amount : trimmed.endsWith("s") ? amount * 1_000 : 0;
        });

      const motionDurationsMs = elements.flatMap((element) => [
        ...parseDuration(element.styles["transition-duration"] ?? "0s"),
        ...parseDuration(element.styles["animation-duration"] ?? "0s"),
      ]);

      let hasReducedMotionRule = false;
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            if (rule.cssText.includes("prefers-reduced-motion")) hasReducedMotionRule = true;
          }
        } catch {
          // Cross-origin stylesheet rules are intentionally unreadable.
        }
      }

      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))
        .filter(isVisible)
        .map((element) => ({
          level: Number(element.tagName.slice(1)),
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
          selector: selectorFor(element),
        }));

      const landmarkNames = new Set<string>();
      for (const element of Array.from(document.querySelectorAll("main,nav,header,footer,aside,form,[role]"))) {
        if (!isVisible(element)) continue;
        const role = element.getAttribute("role");
        const tag = element.tagName.toLowerCase();
        if (["main", "nav", "header", "footer", "aside", "form"].includes(tag)) landmarkNames.add(tag);
        if (role && ["main", "navigation", "banner", "contentinfo", "complementary", "form", "search"].includes(role)) {
          landmarkNames.add(role);
        }
      }

      const viewportMeta = document.querySelector('meta[name="viewport"]')?.getAttribute("content")?.toLowerCase() ?? "";
      const loadedFontFamilies: string[] = [];
      document.fonts.forEach((font) => {
        if (font.status === "loaded") loadedFontFamilies.push(font.family);
      });
      const fontFamilies = [...new Set(loadedFontFamilies)];

      return {
        elements,
        headings,
        landmarks: [...landmarkNames],
        fontsLoaded: fontFamilies,
        motionDurationsMs,
        reducedMotionRespected: hasReducedMotionRule || motionDurationsMs.every((duration) => duration === 0),
        hasViewportMetaScaleLock: /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0+)?(?:\s|,|$)/.test(viewportMeta),
        documentScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
      };
    });

    await page.addStyleTag({
      content: "*,*::before,*::after{animation-play-state:paused!important;transition:none!important;caret-color:transparent!important}",
    });

    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.scrollTo(0, 0);
    });
    const focusBySelector = new Map<string, string>();
    for (let press = 0; press < 40; press += 1) {
      await page.keyboard.press("Tab");
      const observed = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body || element === document.documentElement) return null;
        const selectorFor = (target: Element): string => {
          const testId = target.getAttribute("data-testid");
          if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
          if (target.id) return `#${CSS.escape(target.id)}`;
          const segments: string[] = [];
          let current: Element | null = target;
          while (current && current !== document.documentElement && segments.length < 3) {
            let segment = current.tagName.toLowerCase();
            const classes = Array.from(current.classList).filter(Boolean).slice(0, 2);
            if (classes.length > 0) segment += classes.map((name) => `.${CSS.escape(name)}`).join("");
            const parent: Element | null = current.parentElement;
            if (parent) {
              const sameTag = Array.from(parent.children).filter((child) => child.tagName === current?.tagName);
              if (sameTag.length > 1) segment += `:nth-of-type(${sameTag.indexOf(current) + 1})`;
            }
            segments.unshift(segment);
            if (["MAIN", "NAV", "HEADER", "FOOTER", "ASIDE", "FORM"].includes(current.tagName)) break;
            current = parent;
          }
          return segments.join(" > ");
        };
        const style = getComputedStyle(element);
        const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0
          ? `${style.outlineStyle} ${style.outlineWidth}`
          : style.boxShadow !== "none"
            ? `box-shadow: ${style.boxShadow}`
            : "none";
        return { selector: selectorFor(element), outline };
      });
      if (observed) focusBySelector.set(observed.selector, observed.outline);
    }

    const elements: ElementRecord[] = captured.elements.map((element) => ({
      ...element,
      focusVisibleOutline: focusBySelector.get(element.selector),
    }));
    const axeResult = await new AxeBuilder({ page }).analyze();

    await mkdir(args.outDir, { recursive: true });
    const screenshotPath = join(args.outDir, `${args.shotName}.png`);
    const temporaryPath = join(args.outDir, `.${args.shotName}.stability.png`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: screenshotPath, fullPage: true });
    let previousHash = await sha256File(screenshotPath);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await delay(100);
      await page.screenshot({ path: temporaryPath, fullPage: true });
      const nextHash = await sha256File(temporaryPath);
      if (nextHash === previousHash) break;
      await rename(temporaryPath, screenshotPath);
      previousHash = nextHash;
    }
    await rm(temporaryPath, { force: true });

    return {
      route: args.route,
      viewport: args.viewport,
      url: page.url(),
      title: await page.title(),
      screenshotPath,
      screenshotSha256: await sha256File(screenshotPath),
      elements,
      headings: captured.headings,
      landmarks: captured.landmarks,
      axe: axeResult.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        nodes: violation.nodes.length,
        help: violation.help,
      })),
      fontsLoaded: captured.fontsLoaded,
      reducedMotionRespected: captured.reducedMotionRespected,
      motionDurationsMs: captured.motionDurationsMs,
      hasViewportMetaScaleLock: captured.hasViewportMetaScaleLock,
      documentScrollWidth: captured.documentScrollWidth,
      viewportWidth: captured.viewportWidth,
    };
  } finally {
    await context.close();
    if (!args.browser) await ownedBrowser.close();
    void pageErrors;
  }
};

const routeSlug = (route: string): string => {
  const slug = route.replace(/^\/+|\/+$/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "index";
};

export const captureAll = async (
  config: Config,
  baseUrl: string,
  outDir: string,
  opts: { routes?: string[]; turn?: number } = {},
): Promise<DomSnapshot[]> => {
  const browser = await launchChromium();
  const snapshots: DomSnapshot[] = [];
  try {
    for (const route of opts.routes ?? config.routes) {
      for (const viewport of config.viewports) {
        snapshots.push(await captureScreen({
          url: baseUrl,
          route,
          viewport,
          outDir,
          shotName: `${routeSlug(route)}-${viewport.name}-${opts.turn ?? 0}`,
          browser,
        }));
      }
    }
    return snapshots;
  } finally {
    await browser.close();
  }
};
