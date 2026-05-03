#!/usr/bin/env bun

import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { rootCommand } from "./cli/commands.ts";
import { CliInputError, renderFailure } from "./cli/protocol.ts";

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

function validateCommandShape(args: string[]): CommandShapeFailure | undefined {
  if (args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version")) {
    return undefined;
  }

  if (args.length === 0) {
    return shapeFailure(undefined, "Missing command", { expected: knownTopLevelCommands() });
  }

  const [group, subcommand, input] = args;
  switch (group) {
    case "capabilities":
    case "doctor":
      return rejectUnexpectedArgs(group, args, 1);
    case "codex":
      return validateCodexCommand(subcommand, input, args);
    case "schema":
    case "examples":
      return validateDiscoveryCommand(group, subcommand, input, args);
    case "risk":
      return validateInputCommand("risk evaluate-command", subcommand, input, args, [
        "evaluate-command",
      ]);
    case "context":
      return validateInputCommand("context", subcommand, input, args, [
        "discover",
        "touched-paths",
      ]);
    case "policy":
      return validateInputCommand("policy", subcommand, input, args, [
        "evaluate-tool-call",
        "evaluate-tool-result",
        "override",
        "skill-loaded",
      ]);
    case "provenance":
      return validateInputCommand("provenance", subcommand, input, args, [
        "repo-state",
        "file-state",
      ]);
    case "session":
      return validateInputCommand("session", subcommand, input, args, [
        "append-trace",
        "cleanup",
        "get",
        "override",
        "put-pending-tool",
        "remember-action",
        "skill-loaded",
      ]);
    default:
      return shapeFailure(undefined, `Unknown command '${group ?? ""}'`, {
        expected: knownTopLevelCommands(),
      });
  }
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
