import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { configFromEnv } from "../risk/rules.ts";
import { evaluateRiskCommand } from "../risk/service.ts";
import {
  acceptPolicyOverride,
  confirmPolicySkillsLoaded,
  evaluatePolicyToolCall,
  evaluatePolicyToolResult,
} from "../policy/cli-service.ts";
import { evaluateContextTouchedPaths } from "../context/cli-service.ts";

export const CodexInstallProjectInputSchema = z
  .object({
    target_dir: z.string().min(1).optional(),
    hook_command: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const CodexInstallUserInputSchema = z
  .object({
    codex_home: z.string().min(1).optional(),
    hook_command: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export type CodexInstallProjectInput = z.infer<typeof CodexInstallProjectInputSchema>;
export type CodexInstallUserInput = z.infer<typeof CodexInstallUserInputSchema>;

export async function renderCodexDoctor() {
  const cwd = process.cwd();
  const projectCodexDir = path.join(cwd, ".codex");
  const pluginManifestPath = path.join(cwd, ".codex-plugin", "plugin.json");
  const bundledHooksPath = path.join(cwd, "hooks", "hooks.json");

  return {
    integration: "codex",
    status: "ok",
    checks: [
      await fileCheck("plugin.manifest", pluginManifestPath),
      await fileCheck("plugin.hooks", bundledHooksPath),
      await fileCheck("project.codex_dir", projectCodexDir),
    ],
    limitations: codexLimitations(),
  };
}

export async function installCodexProject(input: CodexInstallProjectInput) {
  const targetDir = path.resolve(input.target_dir ?? process.cwd());
  const codexDir = path.join(targetDir, ".codex");

  await fs.mkdir(codexDir, { recursive: true });

  const configPath = path.join(codexDir, "config.toml");
  const hooksPath = path.join(codexDir, "hooks.json");

  const writes = [
    await ensureCodexHooksFeature(configPath),
    await writeFileIfAllowed(
      hooksPath,
      `${JSON.stringify(codexHooksConfig(input.hook_command), null, 2)}\n`,
      input.force ?? false,
    ),
  ];

  return {
    target_dir: targetDir,
    codex_dir: codexDir,
    hook_command: resolveHookCommand(input.hook_command),
    files: writes,
    limitations: codexLimitations(),
  };
}

export async function installCodexUser(input: CodexInstallUserInput) {
  const codexHome = path.resolve(input.codex_home ?? process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".codex"));
  const configPath = path.join(codexHome, "config.toml");
  const hooksPath = path.join(codexHome, "hooks.json");

  await fs.mkdir(codexHome, { recursive: true });

  const writes = [
    await ensureCodexHooksFeature(configPath),
    await writeFileIfAllowed(
      hooksPath,
      `${JSON.stringify(codexHooksConfig(input.hook_command), null, 2)}\n`,
      input.force ?? false,
    ),
  ];

  return {
    codex_home: codexHome,
    hook_command: resolveHookCommand(input.hook_command),
    files: writes,
    limitations: codexLimitations(),
  };
}

export async function runCodexHook() {
  const payload = await readHookPayload();
  const eventName = stringField(payload, "hook_event_name");

  if (eventName === "SessionStart") {
    writeHookJson({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: sessionStartContext(),
      },
    });
    return;
  }

  if (eventName === "UserPromptSubmit") return runUserPromptSubmitHook(payload);
  if (eventName === "PreToolUse") return runPreToolUseHook(payload);
  if (eventName === "PermissionRequest") return runPermissionRequestHook(payload);
  if (eventName === "PostToolUse") return runPostToolUseHook(payload);
  if (eventName === "Stop") writeHookJson({});
}

async function runUserPromptSubmitHook(payload: unknown) {
  const sessionID = stringField(payload, "session_id");
  const prompt = stringField(payload, "prompt");
  if (!sessionID || !prompt) return;

  const commands = parsePolicyPromptCommands(prompt);
  for (const command of commands) {
    if (command.type === "override") {
      await acceptPolicyOverride({
        root_dir: cwdFromHookPayload(payload),
        session_id: sessionID,
        reason: command.reason,
      });
    } else {
      await confirmPolicySkillsLoaded({
        root_dir: cwdFromHookPayload(payload),
        session_id: sessionID,
        skills: command.skills,
      });
    }
  }

  if (commands.length > 0) {
    writeHookJson({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "[groundwork:policy] Policy command state was recorded.",
      },
    });
  }
}

async function runPreToolUseHook(payload: unknown) {
  const toolName = stringField(payload, "tool_name");
  if (!toolName) return;

  let riskWarning: string | undefined;
  if (toolName === "Bash") {
    const command = commandFromHookPayload(payload);
    if (command) {
      const decision = evaluateRiskCommand({ command, config: configFromEnv(process.env) });
      if (decision.violation) {
        if (decision.decision === "warn") {
          riskWarning = `[groundwork:risk] Warn mode matched ${decision.violation.ruleId}: ${decision.violation.reason}`;
        } else {
          writeHookJson({
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `[groundwork:risk] ${decision.violation.reason}`,
            },
          });
          return;
        }
      }
    }
  }

  const sessionID = stringField(payload, "session_id");
  if (!sessionID) {
    if (riskWarning) writeHookJson({ systemMessage: riskWarning });
    return;
  }
  const result = await evaluatePolicyToolCall({
    root_dir: cwdFromHookPayload(payload),
    directory: cwdFromHookPayload(payload),
    session_id: sessionID,
    tool: normalizePolicyToolName(toolName),
    call_id: stringField(payload, "tool_use_id"),
    args: toolInputFromHookPayload(payload),
  });

  if (isPolicyBlock(result)) {
    writeHookJson({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: renderPolicyDecisionReason(result),
      },
    });
    return;
  }

  if (isPolicyWarn(result)) {
    writeHookJson({ systemMessage: renderPolicyDecisionReason(result) });
    return;
  }

  if (riskWarning) {
    writeHookJson({ systemMessage: riskWarning });
  }
}

async function runPermissionRequestHook(payload: unknown) {
  if (stringField(payload, "tool_name") !== "Bash") return;
  const command = commandFromHookPayload(payload);
  if (!command) return;

  const decision = evaluateRiskCommand({ command, config: configFromEnv(process.env) });
  if (!decision.violation || decision.decision !== "block") return;

  writeHookJson({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        message: `[groundwork:risk] ${decision.violation.reason}`,
      },
    },
  });
}

async function runPostToolUseHook(payload: unknown) {
  const sessionID = stringField(payload, "session_id");
  const toolUseID = stringField(payload, "tool_use_id");
  const toolName = stringField(payload, "tool_name");
  if (!sessionID || !toolUseID) return;

  const result = await evaluatePolicyToolResult({
    root_dir: cwdFromHookPayload(payload),
    session_id: sessionID,
    call_id: toolUseID,
    tool: toolName ? normalizePolicyToolName(toolName) : undefined,
  });
  const contextResult = await evaluateContextTouchedPaths({
    root_dir: cwdFromHookPayload(payload),
    directory: cwdFromHookPayload(payload),
    session_id: sessionID,
    tool: toolName ? normalizePolicyToolName(toolName) : undefined,
    args: toolInputFromHookPayload(payload),
  });
  if (isPolicyWarn(result)) {
    writeHookJson({
      systemMessage: combineHookMessages([
        `${renderPolicyDecisionReason(result)} Side effects may already have happened; inspect and repair if needed.`,
        renderContextReminderMessage(contextResult),
      ]),
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext:
          "Groundwork reported non-blocking post-tool feedback. This cannot undo side effects or provide synthetic prompt injection parity.",
      },
    });
    return;
  }

  if (!isPolicyBlock(result)) {
    if (contextResult.reminders.length > 0) {
      writeHookJson({
        systemMessage: renderContextReminderMessage(contextResult),
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext:
            "Groundwork found new context reminders for touched paths. This is feedback, not synthetic prompt injection parity.",
        },
      });
    }
    return;
  }

  writeHookJson({
    decision: "block",
    reason: `${renderPolicyDecisionReason(result)} Side effects may already have happened; inspect and repair before continuing.`,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "Groundwork policy reported post-tool feedback. This cannot undo side effects.",
    },
  });
}

function codexHooksConfig(hookCommand?: string) {
  const command = resolveHookCommand(hookCommand);
  const commandHook = (statusMessage: string) => ({
    type: "command",
    command,
    timeout: 30,
    statusMessage,
  });
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|clear",
          hooks: [commandHook("Loading Groundwork guidance")],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [commandHook("Recording Groundwork policy commands")],
        },
      ],
      PreToolUse: [
        {
          matcher: "^Bash$|^apply_patch$|^Edit$|^Write$",
          hooks: [commandHook("Checking Groundwork pre-tool policy")],
        },
      ],
      PermissionRequest: [
        {
          matcher: "^Bash$|^apply_patch$|^Edit$|^Write$",
          hooks: [commandHook("Checking Groundwork approval policy")],
        },
      ],
      PostToolUse: [
        {
          matcher: "^Bash$|^apply_patch$|^Edit$|^Write$",
          hooks: [commandHook("Recording Groundwork post-tool feedback")],
        },
      ],
      Stop: [
        {
          hooks: [commandHook("Finalizing Groundwork hook state")],
        },
      ],
    },
  };
}

function resolveHookCommand(hookCommand: string | undefined): string {
  return hookCommand?.trim() || "groundwork codex hook";
}

function sessionStartContext(): string {
  return [
    "Groundwork is available through the `groundwork` CLI for policy, provenance, context, and risk evidence.",
    "Prefer JSON CLI calls over ad hoc reasoning when checking risky shell commands, inherited context files, or local git state.",
  ].join("\n");
}

function codexLimitations() {
  return [
    "Project-local hooks load only for trusted projects.",
    "PreToolUse denial only covers supported Codex tool calls.",
    "PostToolUse cannot undo side effects.",
    "Tool-triggered synthetic prompt injection is unsupported in V1.",
  ];
}

async function fileCheck(name: string, filePath: string) {
  try {
    await fs.access(filePath);
    return { name, ok: true, path: filePath };
  } catch {
    return { name, ok: false, path: filePath };
  }
}

async function writeFileIfAllowed(filePath: string, content: string, force: boolean) {
  const exists = await fileExists(filePath);
  if (exists && !force) {
    return { path: filePath, action: "skipped", reason: "exists" };
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return { path: filePath, action: exists ? "overwritten" : "created" };
}

async function ensureCodexHooksFeature(configPath: string) {
  const exists = await fileExists(configPath);
  if (!exists) {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, initialConfigToml(), "utf8");
    return { path: configPath, action: "created" };
  }

  const original = await fs.readFile(configPath, "utf8");
  const patched = patchCodexHooksFeature(original);
  if (patched === original) {
    return { path: configPath, action: "unchanged" };
  }

  await fs.writeFile(configPath, patched, "utf8");
  return { path: configPath, action: "patched" };
}

function initialConfigToml(): string {
  return [
    "# Groundwork Codex integration",
    "# Project hooks load only when this project is trusted by Codex.",
    "[features]",
    "codex_hooks = true",
    "",
  ].join("\n");
}

function patchCodexHooksFeature(config: string): string {
  const lines = config.split(/\r?\n/);
  const featuresStart = lines.findIndex((line) => line.trim() === "[features]");
  if (featuresStart === -1) {
    return appendBlock(config, ["[features]", "codex_hooks = true"]);
  }

  let insertAt = lines.length;
  for (let index = featuresStart + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index] ?? "")) {
      insertAt = index;
      break;
    }
    if (/^\s*codex_hooks\s*=/.test(lines[index] ?? "")) {
      lines[index] = "codex_hooks = true";
      return ensureTrailingNewline(lines.join("\n"));
    }
  }

  lines.splice(insertAt, 0, "codex_hooks = true");
  return ensureTrailingNewline(lines.join("\n"));
}

function appendBlock(config: string, block: string[]): string {
  const prefix = config.trim().length === 0 ? "" : ensureTrailingNewline(config);
  return `${prefix}${prefix.endsWith("\n\n") || prefix.length === 0 ? "" : "\n"}${block.join("\n")}\n`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

async function readHookPayload(): Promise<unknown> {
  try {
    return await new Response(Bun.stdin.stream()).json();
  } catch {
    writeHookJson({ systemMessage: "[groundwork] Ignoring invalid Codex hook JSON payload." });
    return {};
  }
}

function writeHookJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function cwdFromHookPayload(value: unknown): string | undefined {
  return stringField(value, "cwd");
}

function toolInputFromHookPayload(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = (value as Record<string, unknown>)["tool_input"];
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function commandFromHookPayload(value: unknown): string | undefined {
  const input = toolInputFromHookPayload(value);
  const command = input?.["command"];
  return typeof command === "string" ? command : undefined;
}

function normalizePolicyToolName(toolName: string): string {
  if (toolName === "Bash") return "bash";
  if (toolName === "apply_patch") return "edit";
  return toolName.toLowerCase();
}

function isPolicyBlock(value: unknown): boolean {
  return readDecision(value) === "block";
}

function isPolicyWarn(value: unknown): boolean {
  return readDecision(value) === "warn";
}

function readDecision(value: unknown): string | undefined {
  return value && typeof value === "object"
    ? ((value as Record<string, unknown>)["decision"] as string | undefined)
    : undefined;
}

function renderPolicyDecisionReason(value: unknown): string {
  const messages =
    value && typeof value === "object" && Array.isArray((value as Record<string, unknown>)["messages"])
      ? ((value as Record<string, unknown>)["messages"] as unknown[])
      : [];
  const firstText = messages
    .map((message) =>
      message && typeof message === "object"
        ? (message as Record<string, unknown>)["text"]
        : undefined,
    )
    .find((text): text is string => typeof text === "string" && text.length > 0);
  return firstText ?? "[groundwork:policy] Policy check requested attention.";
}

function renderContextReminderMessage(value: { reminders?: string[] }): string | undefined {
  return value.reminders && value.reminders.length > 0
    ? `[groundwork:context] New inherited instructions apply to touched paths:\n${value.reminders.join("\n\n")}`
    : undefined;
}

function combineHookMessages(messages: Array<string | undefined>): string {
  return messages.filter((message): message is string => !!message).join("\n\n");
}

type ParsedPolicyPromptCommand =
  | { type: "override"; reason: string }
  | { type: "skill-loaded"; skills: string[] };

function parsePolicyPromptCommands(prompt: string): ParsedPolicyPromptCommand[] {
  const commands: ParsedPolicyPromptCommand[] = [];
  for (const line of prompt.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("/policy override ")) {
      const reason = trimmed.slice("/policy override ".length).trim();
      if (reason) commands.push({ type: "override", reason });
      continue;
    }

    if (trimmed.startsWith("/policy skill-loaded ")) {
      const skills = trimmed
        .slice("/policy skill-loaded ".length)
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (skills.length > 0) commands.push({ type: "skill-loaded", skills });
    }
  }
  return commands;
}
