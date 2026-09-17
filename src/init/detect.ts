import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type PackageManager = "pnpm" | "bun" | "yarn" | "npm";
export type Framework = "next" | "nuxt" | "sveltekit" | "astro" | "remix" | "vite" | "cra" | "static" | "unknown";
export type NextRouter = "app" | "pages";

export interface FrameworkDetection {
  framework: Framework;
  router?: NextRouter;
}

export interface DevServerDetection {
  script: string | null;
  scriptName: "dev" | "start" | "serve" | null;
  command?: string;
  port: number;
  url: string;
  note?: string;
}

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "build"]);

function readPackage(cwd: string): PackageJson {
  try {
    return JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as PackageJson;
  } catch {
    return {};
  }
}

function rootHasHtml(cwd: string): boolean {
  try {
    return readdirSync(cwd, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"));
  } catch {
    return false;
  }
}

function hasAppRouter(cwd: string): boolean {
  const appDir = path.join(cwd, "app");
  if (!existsSync(appDir)) return false;
  return walkFiles(appDir).some((file) => /(?:^|\/)(?:layout|page)\.[^/]+$/.test(normalizePath(path.relative(appDir, file))));
}

export function detectPackageManager(cwd: string): PackageManager {
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "bun.lock")) || existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(cwd, "package-lock.json"))) return "npm";

  const declared = readPackage(cwd).packageManager?.split("@")[0];
  if (declared === "pnpm" || declared === "bun" || declared === "yarn" || declared === "npm") return declared;
  return "npm";
}

export function detectFramework(cwd: string): FrameworkDetection {
  const packageJson = readPackage(cwd);
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  if (dependencies.next) return { framework: "next", router: hasAppRouter(cwd) ? "app" : "pages" };
  if (dependencies.nuxt) return { framework: "nuxt" };
  if (dependencies["@sveltejs/kit"]) return { framework: "sveltekit" };
  if (dependencies.astro) return { framework: "astro" };
  if (Object.keys(dependencies).some((name) => name.startsWith("@remix-run/"))) return { framework: "remix" };
  if (dependencies.vite && (dependencies.react || dependencies.vue || dependencies.svelte || dependencies["@vitejs/plugin-react"])) {
    return { framework: "vite" };
  }
  if (dependencies["react-scripts"]) return { framework: "cra" };
  if (rootHasHtml(cwd)) return { framework: "static" };
  return { framework: "unknown" };
}

function frameworkName(framework: Framework | FrameworkDetection): Framework {
  return typeof framework === "string" ? framework : framework.framework;
}

function parsePort(script: string | null): number | null {
  if (!script) return null;
  const patterns = [
    /(?:^|\s)-p\s+(\d{2,5})(?=\s|$)/,
    /(?:^|\s)--port\s+(\d{2,5})(?=\s|$)/,
    /(?:^|\s)--port=(\d{2,5})(?=\s|$)/,
    /(?:^|\s)PORT=(\d{2,5})(?=\s|$)/,
  ];
  for (const pattern of patterns) {
    const match = script.match(pattern);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return null;
}

const DEFAULT_PORTS: Record<Framework, number> = {
  next: 3000,
  nuxt: 3000,
  sveltekit: 5173,
  astro: 4321,
  remix: 3000,
  vite: 5173,
  cra: 3000,
  static: 4173,
  unknown: 3000,
};

export function detectDevServer(
  cwd: string,
  framework: Framework | FrameworkDetection,
  packageManager: PackageManager,
): DevServerDetection {
  const name = frameworkName(framework);
  if (name === "static") {
    const port = DEFAULT_PORTS.static;
    return {
      script: null,
      scriptName: null,
      command: `design-gate serve . --port ${port}`,
      port,
      url: `http://localhost:${port}`,
      note: "Uses design-gate's built-in static server.",
    };
  }

  const scripts = readPackage(cwd).scripts ?? {};
  const scriptName = (["dev", "start", "serve"] as const).find((candidate) => typeof scripts[candidate] === "string") ?? null;
  const script = scriptName ? scripts[scriptName] ?? null : null;
  const port = parsePort(script) ?? DEFAULT_PORTS[name];
  return {
    script,
    scriptName,
    ...(scriptName ? { command: `${packageManager} run ${scriptName}` } : {}),
    port,
    url: `http://localhost:${port}`,
  };
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) visit(path.join(directory, entry.name));
      } else if (entry.isFile()) {
        files.push(path.join(directory, entry.name));
      }
    }
  };
  visit(root);
  return files;
}

function routeFromSegments(segments: string[]): string | null {
  const kept: string[] = [];
  for (const segment of segments) {
    if (/^\(.+\)$/.test(segment)) continue;
    if (segment.startsWith("[") || segment.startsWith("@") || segment.startsWith("_")) return null;
    if (segment) kept.push(segment);
  }
  return kept.length === 0 ? "/" : `/${kept.join("/")}`;
}

function fileRoutes(root: string, pattern: RegExp, toRoute: (relative: string) => string | null): string[] {
  return walkFiles(root)
    .map((file) => normalizePath(path.relative(root, file)))
    .filter((relative) => pattern.test(relative))
    .map(toRoute)
    .filter((route): route is string => route !== null);
}

function nextAppRoutes(cwd: string): string[] {
  const root = path.join(cwd, "app");
  return fileRoutes(root, /(?:^|\/)page\.(?:tsx|jsx|js|mdx)$/, (relative) => {
    const directory = path.posix.dirname(relative);
    return routeFromSegments(directory === "." ? [] : directory.split("/"));
  });
}

function nextPagesRoutes(cwd: string): string[] {
  const root = path.join(cwd, "pages");
  return fileRoutes(root, /\.(?:tsx|jsx|js)$/, (relative) => {
    const withoutExtension = relative.replace(/\.(?:tsx|jsx|js)$/, "");
    const segments = withoutExtension.split("/");
    if (segments[0] === "api") return null;
    const file = segments.at(-1);
    if (file === "_app" || file === "_document") return null;
    if (file === "index") segments.pop();
    return routeFromSegments(segments);
  });
}

function directoryPageRoutes(root: string, pageName: RegExp): string[] {
  return fileRoutes(root, pageName, (relative) => {
    const directory = path.posix.dirname(relative);
    return routeFromSegments(directory === "." ? [] : directory.split("/"));
  });
}

function conventionalPageRoutes(root: string, extension: RegExp): string[] {
  return fileRoutes(root, extension, (relative) => {
    const withoutExtension = relative.replace(extension, "");
    const segments = withoutExtension.split("/");
    if (segments.at(-1) === "index") segments.pop();
    return routeFromSegments(segments);
  });
}

export function detectRoutes(cwd: string, framework: Framework | FrameworkDetection): string[] {
  const detection: FrameworkDetection = typeof framework === "string" ? { framework } : framework;
  let found: string[] = [];
  switch (detection.framework) {
    case "next":
      found = detection.router === "app" || (!detection.router && hasAppRouter(cwd)) ? nextAppRoutes(cwd) : nextPagesRoutes(cwd);
      break;
    case "sveltekit":
      found = directoryPageRoutes(path.join(cwd, "src", "routes"), /(?:^|\/)\+page\.svelte$/);
      break;
    case "astro":
      found = conventionalPageRoutes(path.join(cwd, "src", "pages"), /\.(?:astro|md|mdx)$/);
      break;
    case "nuxt":
      found = conventionalPageRoutes(path.join(cwd, "pages"), /\.vue$/);
      break;
    case "static":
      found = readdirSync(cwd, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".html"))
        .map((entry) => entry.name === "index.html" ? "/" : `/${entry.name}`);
      break;
    default:
      found = ["/"];
  }
  return ["/", ...new Set(found.filter((route) => route !== "/").sort())].slice(0, 8);
}

export function defaultUiGlobs(framework: Framework | FrameworkDetection): string[] {
  switch (frameworkName(framework)) {
    case "next":
      return ["app/**/*.{tsx,jsx,js,mdx,css,scss}", "pages/**/*.{tsx,jsx,js,css,scss}", "components/**/*.{tsx,jsx,js,css,scss}", "src/**/*.{tsx,jsx,js,css,scss}", "**/*.css"];
    case "nuxt":
      return ["pages/**/*.vue", "components/**/*.vue", "layouts/**/*.vue", "assets/**/*.{css,scss}"];
    case "sveltekit":
      return ["src/**/*.{svelte,ts,js,css,scss}"];
    case "astro":
      return ["src/**/*.{astro,tsx,jsx,vue,svelte,html,css,scss,md,mdx}"];
    case "vite":
    case "cra":
      return ["src/**/*.{tsx,jsx,ts,js,vue,svelte,html,css,scss}", "index.html"];
    case "remix":
      return ["app/**/*.{tsx,jsx,ts,js,css,scss}"];
    case "static":
      return ["**/*.{html,css,scss,js}"];
    default:
      return [
        "app/**/*.{tsx,jsx,vue,svelte,astro,html}",
        "src/**/*.{tsx,jsx,vue,svelte,astro,html,css,scss}",
        "components/**/*.{tsx,jsx,vue,svelte,astro,html,css,scss}",
        "pages/**/*.{tsx,jsx,vue,svelte,astro,html,css,scss}",
        "**/*.css",
      ];
  }
}
