import { readFileSync, statSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { maskKey, resolveAnthropicKey, resolveTypesafeKey, saveKeys, validateTypesafeKey } from "../src/init/keys.js";

async function tempHome(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "design-gate-keys-"));
}

describe("API key storage", () => {
  it("resolves environment before home and reports none", async () => {
    const home = await tempHome();
    saveKeys(home, { typesafeApiKey: "home-typesafe", anthropicApiKey: "home-anthropic" });
    expect(resolveTypesafeKey({ TYPESAFE_API_KEY: "env-typesafe" }, home)).toEqual({ key: "env-typesafe", source: "env" });
    expect(resolveTypesafeKey({}, home)).toEqual({ key: "home-typesafe", source: "home" });
    expect(resolveAnthropicKey({}, home)).toEqual({ key: "home-anthropic", source: "home" });
    expect(resolveTypesafeKey({}, await tempHome())).toEqual({ key: null, source: "none" });
  });

  it("merges keys and writes a private config file", async () => {
    const home = await tempHome();
    saveKeys(home, { typesafeApiKey: "typesafe" });
    saveKeys(home, { anthropicApiKey: "anthropic" });
    const file = path.join(home, ".design-gate", "config.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ typesafeApiKey: "typesafe", anthropicApiKey: "anthropic" });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("masks keys", () => {
    expect(maskKey("abcdef123456wxyz")).toBe("abcdef…wxyz");
  });

  it("validates with injected fetch and never needs the network", async () => {
    const okFetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    const unauthorizedFetch = vi.fn(async () => new Response(null, { status: 401 })) as unknown as typeof fetch;
    await expect(validateTypesafeKey("key", okFetch)).resolves.toEqual({ ok: true, status: 200 });
    await expect(validateTypesafeKey("bad", unauthorizedFetch)).resolves.toEqual({ ok: false, status: 401, error: "Invalid TypeSafe API key" });
    expect(okFetch).toHaveBeenCalledWith("https://api.typesafe.ai/v1/systemone", expect.objectContaining({ method: "POST" }));
  });
});
