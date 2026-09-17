import { runCheck } from "../check.js";

export interface CheckCommandOptions {
  json?: boolean;
  routes?: string;
  noVision?: boolean;
  judge?: "jev" | "fake";
  task?: string;
}

export const parseRoutes = (value: string | undefined): string[] | undefined => {
  if (value === undefined) return undefined;
  const routes = value.split(",").map((route) => route.trim()).filter(Boolean);
  return routes.length > 0 ? routes : undefined;
};

export const runCheckCommand = async (
  mode: "check" | "report",
  options: CheckCommandOptions,
): Promise<number> => {
  const result = await runCheck({
    cwd: process.cwd(),
    mode,
    json: options.json ?? false,
    ...(parseRoutes(options.routes) ? { routes: parseRoutes(options.routes) } : {}),
    ...(options.noVision ? { noVision: true } : {}),
    ...(options.judge ? { judgeOverride: options.judge } : {}),
    ...(options.task ? { task: options.task } : {}),
  });
  return result.exitCode;
};
