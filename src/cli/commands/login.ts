import os from "node:os";

import { promptHidden, saveKeys, validateTypesafeKey } from "../../init/index.js";

export const login = async (): Promise<string> => {
  if (!process.stdin.isTTY) throw new Error("design-gate login requires an interactive TTY.");
  process.stdout.write("Create a TypeSafe API key at https://console.typesafe.ai\n");
  const key = await promptHidden("TypeSafe API key: ");
  const validation = await validateTypesafeKey(key);
  if (!validation.ok) throw new Error(validation.error ?? "TypeSafe API key validation failed.");
  saveKeys(os.homedir(), { typesafeApiKey: key });
  return "TypeSafe API key saved.";
};
