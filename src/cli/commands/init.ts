import { runInit } from "../../init/index.js";
import { runCheck } from "../check.js";

export const runInitCommand = async (options: { yes?: boolean; skipKey?: boolean }): Promise<number> => {
  await runInit({
    cwd: process.cwd(),
    interactive: Boolean(process.stdin.isTTY && !options.yes),
    ...(options.skipKey ? { skipKey: true } : {}),
  });
  const result = await runCheck({ cwd: process.cwd(), mode: "report", json: false, noVision: true });
  process.stdout.write(result.json.notes.includes("KEY NEEDED")
    ? `Initial check: ${result.json.verdict} on measured checks only. Run \`design-gate login\` to enable the judged score.\n`
    : `Initial design score: ${Math.round(result.json.overall * 100)}% (${result.json.verdict})\n`);
  return result.exitCode === 2 ? 2 : 0;
};
