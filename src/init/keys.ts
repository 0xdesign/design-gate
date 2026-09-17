import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";

export type KeySource = "env" | "home" | "none";

export interface ResolvedKey {
  key: string | null;
  source: KeySource;
}

export interface SavedKeys {
  typesafeApiKey?: string;
  anthropicApiKey?: string;
}

interface KeyFile {
  typesafeApiKey?: unknown;
  anthropicApiKey?: unknown;
}

function readKeyFile(home: string): KeyFile {
  const file = path.join(home, ".design-gate", "config.json");
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8")) as KeyFile;
  } catch {
    return {};
  }
}

function resolveKey(envName: string, fileName: keyof KeyFile, env: NodeJS.ProcessEnv, home: string): ResolvedKey {
  const envValue = env[envName]?.trim();
  if (envValue) return { key: envValue, source: "env" };
  const saved = readKeyFile(home)[fileName];
  if (typeof saved === "string" && saved.trim()) return { key: saved.trim(), source: "home" };
  return { key: null, source: "none" };
}

export function resolveTypesafeKey(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): ResolvedKey {
  return resolveKey("TYPESAFE_API_KEY", "typesafeApiKey", env, home);
}

export function resolveAnthropicKey(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): ResolvedKey {
  return resolveKey("ANTHROPIC_API_KEY", "anthropicApiKey", env, home);
}

export function saveKeys(home: string, keys: SavedKeys): void {
  const directory = path.join(home, ".design-gate");
  const file = path.join(directory, "config.json");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const current = readKeyFile(home);
  const next: Record<string, string> = {};
  if (typeof current.typesafeApiKey === "string") next.typesafeApiKey = current.typesafeApiKey;
  if (typeof current.anthropicApiKey === "string") next.anthropicApiKey = current.anthropicApiKey;
  if (keys.typesafeApiKey !== undefined) next.typesafeApiKey = keys.typesafeApiKey;
  if (keys.anthropicApiKey !== undefined) next.anthropicApiKey = keys.anthropicApiKey;
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(file, 0o600);
}

export function maskKey(key: string): string {
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}

export function promptHidden(question: string): Promise<string> {
  if (!process.stdin.isTTY) return Promise.reject(new Error("Hidden input requires an interactive TTY"));
  return new Promise((resolve) => {
    const muted = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const interface_ = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    process.stdout.write(question);
    interface_.question("", (answer) => {
      process.stdout.write("\n");
      interface_.close();
      resolve(answer.trim());
    });
  });
}

export async function validateTypesafeKey(
  key: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const response = await fetchImpl("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        state: "ping",
        model: "jev-latest",
        questions: { ok: { type: "noul", instructions: "Is the state the word ping?" } },
      }),
    });
    if (response.status === 200) return { ok: true, status: 200 };
    return {
      ok: false,
      status: response.status,
      error: response.status === 401 ? "Invalid TypeSafe API key" : `TypeSafe API request failed with status ${response.status}`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
