#!/usr/bin/env bun

import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { rootCommand } from "./cli/commands.ts";
import { CliInputError, renderFailure } from "./cli/protocol.ts";

const ROOT_LOG_LEVELS = [
  "all",
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
  "none",
] as const;

const cli = Command.run(rootCommand, {
  name: "groundwork",
  version: "0.1.0",
});

const preflightError = validateCommandShape(Bun.argv.slice(2));
if (preflightError) {
  process.exitCode = 1;
  process.stderr.write(`${renderFailure(preflightError.command, preflightError.error)}\n`);
  process.exit();
}

BunRuntime.runMain(
  cli(Bun.argv).pipe(
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        process.exitCode = 1;
        process.stderr.write(`${renderFailure(undefined, new Error(String(cause)))}\n`);
      }),
    ),
    Effect.provide(BunContext.layer),
  ),
);

interface CommandShapeFailure {
  command?: string;
  error: CliInputError;
}

interface RootExecutionOptionsResult {
  args: string[];
  failure?: CommandShapeFailure;
}

function validateCommandShape(args: string[]): CommandShapeFailure | undefined {
  if (args.some(isRootParserOwnedOption)) {
    return undefined;
  }

  if (hasRootCompletionOption(args)) {
    return undefined;
  }

  const normalized = stripRootExecutionOptions(args);
  if (normalized.failure) {
    return normalized.failure;
  }
  const commandArgs = normalized.args;

  if (commandArgs.length === 0) {
    return shapeFailure(undefined, "Missing command", { expected: knownTopLevelCommands() });
  }

  const [group, subcommand, input] = commandArgs;
  switch (group) {
    case "capabilities":
    case "doctor":
      return rejectUnexpectedArgs(group, commandArgs, 1);
    case "codex":
      return validateCodexCommand(subcommand, input, commandArgs);
    case "schema":
    case "examples":
      return validateDiscoveryCommand(group, subcommand, input, commandArgs);
    case "risk":
      return validateInputCommand("risk evaluate-command", subcommand, input, commandArgs, [
        "evaluate-command",
      ]);
    case "context":
      return validateInputCommand("context", subcommand, input, commandArgs, [
        "discover",
        "touched-paths",
      ]);
    case "policy":
      return validateInputCommand("policy", subcommand, input, commandArgs, [
        "evaluate-tool-call",
        "evaluate-tool-result",
        "override",
        "skill-loaded",
      ]);
    case "provenance":
      return validateInputCommand("provenance", subcommand, input, commandArgs, [
        "authority",
        "block-read",
        "commit-expand",
        "commit-materialize",
        "diff-expand",
        "file-state",
        "hotspots",
        "pr-expand",
        "pr-materialize",
        "read",
        "repo-state",
        "run",
        "span-history",
        "stability-report",
        "tree-expand",
        "worktree-overview",
      ]);
    case "session":
      return validateInputCommand("session", subcommand, input, commandArgs, [
        "append-trace",
        "cleanup",
        "get",
        "override",
        "put-pending-tool",
        "remember-action",
        "render-compaction",
        "skill-loaded",
      ]);
    default:
      return shapeFailure(undefined, `Unknown command '${group ?? ""}'`, {
        expected: knownTopLevelCommands(),
      });
  }
}

function isRootParserOwnedOption(arg: string): boolean {
  return arg === "--help" || arg === "-h" || arg === "--version" || arg === "--wizard";
}

function hasRootCompletionOption(args: string[]): boolean {
  return args.some((arg) => arg === "--completions" || arg.startsWith("--completions="));
}

function stripRootExecutionOptions(args: string[]): RootExecutionOptionsResult {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--log-level") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("-")) {
        return { args: result, failure: invalidLogLevelFailure(undefined) };
      }
      const failure = validateLogLevelValue(value);
      if (failure) {
        return { args: result, failure };
      }
      index += 1;
      continue;
    }
    if (arg.startsWith("--log-level=")) {
      const value = arg.slice("--log-level=".length);
      const failure = validateLogLevelValue(value);
      if (failure) {
        return { args: result, failure };
      }
      continue;
    }
    result.push(arg);
  }
  return { args: result };
}

function validateLogLevelValue(value: string): CommandShapeFailure | undefined {
  if (!ROOT_LOG_LEVELS.includes(value as (typeof ROOT_LOG_LEVELS)[number])) {
    return invalidLogLevelFailure(value);
  }
  return undefined;
}

function invalidLogLevelFailure(value: string | undefined): CommandShapeFailure {
  return shapeFailure(undefined, value === undefined ? "Missing value for '--log-level'" : "Invalid value for '--log-level'", {
    expected: [...ROOT_LOG_LEVELS],
    ...(value === undefined ? {} : { received: value }),
  });
}

function validateCodexCommand(
  subcommand: string | undefined,
  input: string | undefined,
  args: string[],
): CommandShapeFailure | undefined {
  const expected = ["doctor", "hook", "install-project", "install-user"];
  if (subcommand === undefined) {
    return shapeFailure("codex", "Missing codex subcommand", { expected });
  }

  if (subcommand === "doctor" || subcommand === "hook") {
    return rejectUnexpectedArgs(`codex ${subcommand}`, args, 2);
  }

  if (subcommand === "install-project" || subcommand === "install-user") {
    if (input === undefined) {
      return shapeFailure(`codex ${subcommand}`, "Missing required argument 'input'");
    }
    return rejectUnexpectedArgs(`codex ${subcommand}`, args, 3);
  }

  return shapeFailure("codex", `Unknown codex subcommand '${subcommand}'`, { expected });
}

function validateDiscoveryCommand(
  group: "schema" | "examples",
  subcommand: string | undefined,
  target: string | undefined,
  args: string[],
): CommandShapeFailure | undefined {
  if (subcommand === undefined) {
    return shapeFailure(group, `Missing ${group} subcommand`, { expected: ["list", "show"] });
  }

  if (subcommand === "list") {
    return rejectUnexpectedArgs(`${group} list`, args, 2);
  }

  if (subcommand === "show") {
    if (target === undefined) {
      return shapeFailure(`${group} show`, "Missing required argument 'target'");
    }
    return rejectUnexpectedArgs(`${group} show`, args, 3);
  }

  return shapeFailure(group, `Unknown ${group} subcommand '${subcommand}'`, {
    expected: ["list", "show"],
  });
}

function validateInputCommand(
  commandPrefix: string,
  subcommand: string | undefined,
  input: string | undefined,
  args: string[],
  expectedSubcommands: string[],
): CommandShapeFailure | undefined {
  const command = expectedSubcommands.length === 1 ? commandPrefix : `${commandPrefix} ${subcommand ?? ""}`.trim();
  if (subcommand === undefined) {
    return shapeFailure(commandPrefix, "Missing subcommand", { expected: expectedSubcommands });
  }

  if (!expectedSubcommands.includes(subcommand)) {
    return shapeFailure(commandPrefix, `Unknown subcommand '${subcommand}'`, {
      expected: expectedSubcommands,
    });
  }

  if (input === undefined) {
    return shapeFailure(command, "Missing required argument 'input'");
  }

  return rejectUnexpectedArgs(command, args, 3);
}

function rejectUnexpectedArgs(
  command: string,
  args: string[],
  maxCount: number,
): CommandShapeFailure | undefined {
  if (args.length <= maxCount) {
    return undefined;
  }
  return shapeFailure(command, "Too many arguments", {
    unexpected: args.slice(maxCount),
  });
}

function shapeFailure(
  command: string | undefined,
  message: string,
  details?: Record<string, unknown>,
): CommandShapeFailure {
  return {
    command,
    error: new CliInputError(message, details),
  };
}

function knownTopLevelCommands(): string[] {
  return [
    "capabilities",
    "codex",
    "context",
    "doctor",
    "examples",
    "policy",
    "provenance",
    "risk",
    "schema",
    "session",
  ];
}
