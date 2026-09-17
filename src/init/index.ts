import os from "node:os";
import readline from "node:readline/promises";
import { BrandSchema, type Brand, type Config } from "../types.js";
import { ensureBrowser } from "../capture/browser.js";
import { detectAgents, installSkill, resolveSkillSourceDir, type AgentTarget } from "./agents.js";
import { extractBrand } from "./brand.js";
import { buildConfig, ensureGitignore, writeBrand, writeConfig } from "./config.js";
import { detectDevServer, detectFramework, detectPackageManager, detectRoutes } from "./detect.js";
import { promptHidden, resolveTypesafeKey, saveKeys, validateTypesafeKey } from "./keys.js";

export interface InitOptions {
  cwd: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
  interactive: boolean;
  skipKey?: boolean;
  /** Download Chromium for screenshots when missing (default true). */
  installBrowser?: boolean;
  log?: (message: string) => void;
  ask?: (question: string, choices?: string[]) => Promise<string>;
}

export interface InitResult {
  config: Config;
  brand: Brand;
  agents: AgentTarget[];
  skillInstall: { installed: string[]; skipped: string[] };
  key: { source: string };
}

async function defaultAsk(question: string, choices?: string[]): Promise<string> {
  const prompt = choices?.length ? `${question} (${choices.join("/")}): ` : `${question}: `;
  const interface_ = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await interface_.question(prompt)).trim();
  } finally {
    interface_.close();
  }
}

function yes(value: string): boolean {
  return /^(?:y|yes|true|1)$/i.test(value.trim());
}

async function interviewBrand(brand: Brand, ask: NonNullable<InitOptions["ask"]>): Promise<Brand> {
  const intentAnswer = await ask("What visual intent should design-gate expect?", ["conventional", "expressive", "brutalist"]);
  const intent = (["conventional", "expressive", "brutalist"] as const).includes(intentAnswer as Brand["intent"])
    ? intentAnswer as Brand["intent"]
    : "conventional";
  const voiceAnswer = await ask("Which voice adjectives describe the product? (comma-separated)");
  const darkAnswer = await ask("Does the product support dark mode?", ["yes", "no"]);
  return BrandSchema.parse({
    ...brand,
    intent,
    voice: voiceAnswer.split(/[,/]/).map((value) => value.trim()).filter(Boolean).slice(0, 6),
    darkMode: yes(darkAnswer),
  });
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  const home = options.home ?? os.homedir();
  const env = options.env ?? process.env;
  const log = options.log ?? console.log;
  const ask = options.ask ?? defaultAsk;

  const agents = detectAgents(options.cwd, home);
  const skillInstall = installSkill(options.cwd, agents, resolveSkillSourceDir());
  if (options.installBrowser !== false) {
    const browser = await ensureBrowser(log);
    if (browser === "failed") log("Could not download Chromium; run `npx playwright install chromium` manually.");
  }
  const packageManager = detectPackageManager(options.cwd);
  const framework = detectFramework(options.cwd);
  const devServer = detectDevServer(options.cwd, framework, packageManager);
  const routes = detectRoutes(options.cwd, framework);
  let brand = await extractBrand(options.cwd);
  if (brand.palette.length === 0 && options.interactive) brand = await interviewBrand(brand, ask);

  let config = buildConfig({ framework, devServer, routes });
  config = writeConfig(options.cwd, config, { merge: true });
  brand = writeBrand(options.cwd, brand, { merge: true });
  ensureGitignore(options.cwd);

  let resolved = resolveTypesafeKey(env, home);
  if (resolved.source === "none" && options.interactive && !options.skipKey) {
    log("Create a TypeSafe API key at https://console.typesafe.ai");
    const entered = await promptHidden("TypeSafe API key: ");
    const validation = await validateTypesafeKey(entered);
    if (validation.ok) {
      saveKeys(home, { typesafeApiKey: entered });
      resolved = { key: entered, source: "home" };
    } else {
      log(`TypeSafe API key was not saved: ${validation.error ?? "validation failed"}.`);
    }
  } else if (resolved.source === "none" && !options.interactive) {
    log("No TypeSafe API key found; facts-only mode will run until `design-gate login`.");
  }

  const detectedAgentNames = agents.filter((agent) => agent.detected).map((agent) => agent.id);
  log([
    `agents=${detectedAgentNames.length > 0 ? detectedAgentNames.join(",") : "fallback"}`,
    `framework=${framework.framework}${framework.router ? `/${framework.router}` : ""}`,
    `url=${devServer.url}`,
    `routes=${routes.join(",")}`,
    `palette=${brand.palette.length}`,
    `fonts=${brand.type.map((entry) => entry.family).join(",") || "none"}`,
    `key=${resolved.source}`,
  ].join(" "));

  return { config, brand, agents, skillInstall, key: { source: resolved.source } };
}

export { detectAgents, installSkill, resolveSkillSourceDir } from "./agents.js";
export type { AgentId, AgentTarget } from "./agents.js";
export { extractBrand } from "./brand.js";
export { buildConfig, ensureGitignore, readConfig, writeBrand, writeConfig } from "./config.js";
export type { DetectedProject, MergeOptions } from "./config.js";
export { defaultUiGlobs, detectDevServer, detectFramework, detectPackageManager, detectRoutes } from "./detect.js";
export type { DevServerDetection, Framework, FrameworkDetection, NextRouter, PackageManager } from "./detect.js";
export { maskKey, promptHidden, resolveAnthropicKey, resolveTypesafeKey, saveKeys, validateTypesafeKey } from "./keys.js";
export type { KeySource, ResolvedKey, SavedKeys } from "./keys.js";
