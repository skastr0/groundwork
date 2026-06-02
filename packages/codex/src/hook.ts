import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Effect } from "effect";
import {
  acceptPolicyOverride,
  confirmPolicySkillsLoadedEffect,
  configFromEnv,
  evaluateContextTouchedPaths,
  evaluatePolicyToolCall,
  evaluatePolicyToolResult,
  evaluateRiskCommand,
} from "@skastr0/groundwork-core/cli-support";

type PreToolRiskResult =
  | { kind: "continue"; warning?: string }
  | { kind: "deny"; reason: string };

type PostToolHookContext = {
  rootDir: string | undefined;
  sessionID: string;
  toolUseID: string;
  tool: string | undefined;
  args: Record<string, unknown> | undefined;
};

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
      await Effect.runPromise(
        confirmPolicySkillsLoadedEffect({
          root_dir: cwdFromHookPayload(payload),
          session_id: sessionID,
          skills: command.skills,
        }),
      );
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

  const riskResult = evaluatePreToolRisk(payload, toolName);
  if (riskResult.kind === "deny") {
    writePreToolDeny(`[groundwork:risk] ${riskResult.reason}`);
    return;
  }

  const sessionID = stringField(payload, "session_id");
  if (!sessionID) {
    writeHookSystemMessage(riskResult.warning);
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

  if (writePreToolPolicyFeedback(result)) {
    return;
  }

  writeHookSystemMessage(riskResult.warning);
}

function evaluatePreToolRisk(payload: unknown, toolName: string): PreToolRiskResult {
  if (toolName !== "Bash") return { kind: "continue" };

  const command = commandFromHookPayload(payload);
  if (!command) return { kind: "continue" };

  const decision = evaluateRiskCommand({ command, config: configFromEnv(process.env) });
  if (!decision.violation) return { kind: "continue" };

  if (decision.decision === "warn") {
    return {
      kind: "continue",
      warning: `[groundwork:risk] Warn mode matched ${decision.violation.ruleId}: ${decision.violation.reason}`,
    };
  }

  return { kind: "deny", reason: decision.violation.reason };
}

function writePreToolPolicyFeedback(result: unknown): boolean {
  if (isPolicyBlock(result)) {
    writePreToolDeny(renderPolicyDecisionReason(result));
    return true;
  }

  if (isPolicyWarn(result)) {
    writeHookJson({ systemMessage: renderPolicyDecisionReason(result) });
    return true;
  }

  return false;
}

function writePreToolDeny(reason: string): void {
  writeHookJson({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}

function writeHookSystemMessage(message: string | undefined): void {
  if (message) writeHookJson({ systemMessage: message });
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
  const context = readPostToolHookContext(payload);
  if (!context) return;

  const result = await evaluatePolicyToolResult({
    root_dir: context.rootDir,
    session_id: context.sessionID,
    call_id: context.toolUseID,
    tool: context.tool,
  });
  const contextResult = await evaluateContextTouchedPaths({
    root_dir: context.rootDir,
    directory: context.rootDir,
    session_id: context.sessionID,
    tool: context.tool,
    args: context.args,
  });

  writePostToolFeedback(result, contextResult);
}

function readPostToolHookContext(payload: unknown): PostToolHookContext | undefined {
  const sessionID = stringField(payload, "session_id");
  const toolUseID = stringField(payload, "tool_use_id");
  if (!sessionID || !toolUseID) return undefined;

  const toolName = stringField(payload, "tool_name");
  return {
    rootDir: cwdFromHookPayload(payload),
    sessionID,
    toolUseID,
    tool: toolName ? normalizePolicyToolName(toolName) : undefined,
    args: toolInputFromHookPayload(payload),
  };
}

function writePostToolFeedback(
  result: unknown,
  contextResult: Awaited<ReturnType<typeof evaluateContextTouchedPaths>>,
): void {
  if (isPolicyWarn(result)) {
    writePostToolWarnFeedback(result, contextResult);
    return;
  }

  if (!isPolicyBlock(result)) {
    writePostToolContextFeedback(contextResult);
    return;
  }

  writePostToolBlockFeedback(result);
}

function writePostToolWarnFeedback(
  result: unknown,
  contextResult: Awaited<ReturnType<typeof evaluateContextTouchedPaths>>,
): void {
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
}

function writePostToolContextFeedback(
  contextResult: Awaited<ReturnType<typeof evaluateContextTouchedPaths>>,
): void {
  if (contextResult.reminders.length === 0) return;

  writeHookJson({
    systemMessage: renderContextReminderMessage(contextResult),
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "Groundwork found new context reminders for touched paths. This is feedback, not synthetic prompt injection parity.",
    },
  });
}

function writePostToolBlockFeedback(result: unknown): void {
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

function sessionStartContext(): string {
  return [
    "The Groundwork Codex plugin is active for policy, context, provenance, and risk feedback.",
    "Treat Groundwork hook feedback as repository guardrail context and address any reported policy or inherited-instruction issues.",
  ].join("\n");
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
    const input = readFileSync(0, "utf8");
    if (input.trim().length === 0) return {};
    return JSON.parse(input);
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

function isDirectRun(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false;
}

if (isDirectRun()) {
  runCodexHook().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    writeHookJson({ systemMessage: `[groundwork] Codex hook failed: ${message}` });
    process.exitCode = 1;
  });
}
