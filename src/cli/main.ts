#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCheckCommand, type CheckCommandOptions } from "./commands/check.js";
import { explainQuestion } from "./commands/explain.js";
import { runInitCommand } from "./commands/init.js";
import { login } from "./commands/login.js";
import { openLatestRun } from "./commands/open.js";
import { renderRuns } from "./commands/runs.js";
import { serve } from "./commands/serve.js";
import { renderStatus } from "./commands/status.js";
import { waiveQuestion } from "./commands/waive.js";

const judgeValue = (value: string): "jev" | "fake" => {
  if (value === "jev" || value === "fake") return value;
  throw new InvalidArgumentError("judge must be jev or fake");
};

const integerValue = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) throw new InvalidArgumentError("port must be between 0 and 65535");
  return parsed;
};

const setExitCode = (code: number): void => {
  process.exitCode = code;
};

const addCheckOptions = (command: Command): Command => command
  .option("--json", "print machine-readable JSON to stdout")
  .option("--routes <list>", "comma-separated routes to capture")
  .option("--no-vision", "skip visual observations")
  .option("--judge <jev|fake>", "judge implementation", judgeValue)
  .option("--task <text>", "task context recorded with the run");

export const createProgram = (): Command => {
  const program = new Command()
    .name("design-gate")
    .description("Judge rendered UI and loop coding agents until approval")
    .exitOverride()
    .showHelpAfterError()
    .configureOutput({ writeErr: (text) => process.stderr.write(text) });

  program.command("init")
    .description("zero-config setup: detect agents, framework, dev server, routes and brand; install the skill")
    .option("--yes", "accept non-interactive defaults")
    .option("--skip-key", "do not prompt for a TypeSafe API key")
    .action(async (options: { yes?: boolean; skipKey?: boolean }) => setExitCode(await runInitCommand(options)));

  addCheckOptions(program.command("check").description("render, measure, judge and return a ranked fix list (the gate)"))
    .action(async (options: CheckCommandOptions) => setExitCode(await runCheckCommand("check", options)));

  addCheckOptions(program.command("report").description("non-blocking dry run with the same output; never counts as a turn"))
    .action(async (options: CheckCommandOptions) => setExitCode(await runCheckCommand("report", options)));

  program.command("explain <question-id>")
    .description("show a question, its criteria, its fix and the state it read on the last turn")
    .option("--turn <n>", "turn number", integerValue)
    .action((questionId: string, options: { turn?: number }) => {
      process.stdout.write(`${explainQuestion(questionId, options.turn)}\n`);
    });

  program.command("waive <question-id>")
    .description("human-only: record that a question does not apply to this project")
    .requiredOption("--reason <text>", "why this question does not apply")
    .action((questionId: string, options: { reason: string }) => {
      process.stdout.write(`${waiveQuestion(questionId, options.reason)}\n`);
    });

  program.command("open")
    .description("open the latest run page in the browser")
    .action(() => {
      process.stdout.write(`${openLatestRun()}\n`);
    });

  program.command("runs")
    .description("list past runs with verdicts and cost")
    .action(() => {
      process.stdout.write(`${renderRuns()}\n`);
    });

  program.command("login")
    .description("store your TypeSafe API key (human-only, hidden input)")
    .action(async () => {
      process.stdout.write(`${await login()}\n`);
    });

  program.command("status")
    .description("show key sources, config presence and the last verdict")
    .action(() => {
      process.stdout.write(`${renderStatus()}\n`);
    });

  program.command("serve <dir>", { hidden: true })
    .option("--port <n>", "port to listen on", integerValue, 0)
    .action(async (directory: string, options: { port: number }) => serve(directory, options.port));

  return program;
};

export const main = async (argv = process.argv): Promise<void> => {
  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode === 0 ? 0 : 2;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
