import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  acceptPolicyOverride,
  configFromEnv,
  evaluateContextTouchedPaths,
  evaluatePolicyToolCall,
  evaluatePolicyToolResult,
  evaluateRiskCommand,
  evaluateRiskToolCall,
  evaluateRiskToolResult,
  markSessionSkillsLoaded,
  recordRiskToolPending,
} from "@skastr0/groundwork-core/cli-support";

type PreToolRiskResult =
  | { kind: "continue"; messages: string[]; pendingRisk?: PendingRiskExecution }
  | { kind: "deny"; reason: string };

interface PendingRiskExecution {
  fingerprint: string;
}

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

  const policyCommands = parsePolicyPromptCommands(prompt);
  for (const policyCommand of policyCommands) {
    if (policyCommand.type === "override") {
      await acceptPolicyOverride({
        root_dir: cwdFromHookPayload(payload),
        session_id: sessionID,
        reason: policyCommand.reason,
      });
    } else {
      await markSessionSkillsLoaded({
        root_dir: cwdFromHookPayload(payload),
        session_id: sessionID,
        skills: policyCommand.skills,
      });
    }
  }

  if (policyCommands.length > 0) {
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

  const riskResult = await evaluatePreToolRisk(payload, toolName);
  if (riskResult.kind === "deny") {
    writePreToolDeny(riskResult.reason);
    return;
  }

  const sessionID = stringField(payload, "session_id");
  if (!sessionID) {
    writeHookSystemMessage(combineHookMessages(riskResult.messages));
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
    writePreToolDeny(combineHookMessages([renderPolicyDecisionReason(result), ...riskResult.messages]));
    return;
  }

  await recordPendingRiskExecution(payload, sessionID, riskResult);

  if (isPolicyWarn(result)) {
    writeHookJson({
      systemMessage: combineHookMessages([renderPolicyDecisionReason(result), ...riskResult.messages]),
    });
    return;
  }
  writeHookSystemMessage(combineHookMessages(riskResult.messages));
}

async function evaluatePreToolRisk(
  payload: unknown,
  toolName: string,
): Promise<PreToolRiskResult> {
  if (toolName !== "Bash") return { kind: "continue", messages: [] };

  const command = commandFromHookPayload(payload);
  if (!command) return { kind: "continue", messages: [] };

  const sessionID = stringField(payload, "session_id");
  if (sessionID) return evaluateSessionPreToolRisk(payload, sessionID, command);
  return evaluateStatelessPreToolRisk(command);
}

async function evaluateSessionPreToolRisk(
  payload: unknown,
  sessionID: string,
  command: string,
): Promise<PreToolRiskResult> {
  const result = await evaluateRiskToolCall({
    root_dir: cwdFromHookPayload(payload),
    session_id: sessionID,
    call_id: stringField(payload, "tool_use_id"),
    tool: "bash",
    command,
    cwd: cwdFromHookPayload(payload),
    config: configFromEnv(process.env),
    record_pending: false,
  });

  if (result.decision === "block") {
    return { kind: "deny", reason: renderRiskMessages(result) };
  }

  if (result.effect !== "warn_after_block_once" || typeof result.fingerprint !== "string") {
    return { kind: "continue", messages: readRiskMessages(result) };
  }

  if (!stringField(payload, "tool_use_id")) {
    return {
      kind: "deny",
      reason: combineHookMessages([
        renderRiskMessages(result),
        "[groundwork:risk] Retry blocked because no Codex tool_use_id was supplied for execution reporting.",
      ]),
    };
  }
  return {
    kind: "continue",
    messages: readRiskMessages(result),
    pendingRisk: { fingerprint: result.fingerprint },
  };
}

function evaluateStatelessPreToolRisk(command: string): PreToolRiskResult {
  const riskDecision = evaluateRiskCommand({ command, config: configFromEnv(process.env) });
  if (!riskDecision.violation) return { kind: "continue", messages: [] };

  if (riskDecision.decision === "warn") {
    return {
      kind: "continue",
      messages: [
        `[groundwork:risk] Warn mode matched ${riskDecision.violation.ruleId}: ${riskDecision.violation.reason}`,
      ],
    };
  }

  return {
    kind: "deny",
    reason:
      `[groundwork:risk] ${riskDecision.violation.reason} (rule: ${riskDecision.violation.ruleId}). ` +
      "No Codex session_id was present, so block-once retry state could not be recorded.",
  };
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

async function recordPendingRiskExecution(
  payload: unknown,
  sessionID: string,
  riskResult: Extract<PreToolRiskResult, { kind: "continue" }>,
): Promise<void> {
  const callID = stringField(payload, "tool_use_id");
  if (!callID || !riskResult.pendingRisk) return;

  await recordRiskToolPending({
    root_dir: cwdFromHookPayload(payload),
    session_id: sessionID,
    call_id: callID,
    fingerprint: riskResult.pendingRisk.fingerprint,
  });
}

function writeHookSystemMessage(message: string | undefined): void {
  if (message) writeHookJson({ systemMessage: message });
}

async function runPermissionRequestHook(payload: unknown) {
  if (stringField(payload, "tool_name") !== "Bash") return;
  const command = commandFromHookPayload(payload);
  if (!command) return;

  const sessionID = stringField(payload, "session_id");
  if (sessionID) {
    await handleSessionPermissionRequest(payload, sessionID, command);
    return;
  }

  handleStatelessPermissionRequest(command);
}

async function handleSessionPermissionRequest(
  payload: unknown,
  sessionID: string,
  command: string,
): Promise<void> {
  const result = await evaluateRiskToolCall({
    root_dir: cwdFromHookPayload(payload),
    session_id: sessionID,
    call_id: stringField(payload, "tool_use_id"),
    tool: "bash",
    command,
    cwd: cwdFromHookPayload(payload),
    config: configFromEnv(process.env),
    record_pending: false,
  });

  const message = renderRiskMessages(result);
  if (result.decision === "block") {
    writePermissionRequestDeny(message);
    return;
  }
  if (message) writePermissionRequestWarning(message);
}

function handleStatelessPermissionRequest(command: string): void {
  const riskDecision = evaluateRiskCommand({ command, config: configFromEnv(process.env) });
  if (!riskDecision.violation || riskDecision.decision !== "block") return;

  writePermissionRequestDeny(
    `[groundwork:risk] ${riskDecision.violation.reason} (rule: ${riskDecision.violation.ruleId}). ` +
      "No Codex session_id was present, so block-once retry state could not be recorded.",
  );
}

function writePermissionRequestDeny(message: string): void {
  writeHookJson({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: "deny",
        message,
      },
    },
  });
}

function writePermissionRequestWarning(message: string): void {
  writeHookJson({
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      additionalContext:
        "Groundwork risk is warning only here; it is not granting or denying the Codex permission request.",
    },
  });
}

async function runPostToolUseHook(payload: unknown) {
  const context = readPostToolHookContext(payload);
  if (!context) return;

  const riskResult = await evaluateRiskToolResult({
    root_dir: context.rootDir,
    session_id: context.sessionID,
    call_id: context.toolUseID,
  });
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

  writePostToolFeedback(result, contextResult, riskResult);
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
  riskResult: Awaited<ReturnType<typeof evaluateRiskToolResult>>,
): void {
  if (isPolicyWarn(result)) {
    writePostToolWarnFeedback(result, contextResult, riskResult);
    return;
  }

  if (!isPolicyBlock(result)) {
    writePostToolContextFeedback(contextResult, riskResult);
    return;
  }

  writePostToolBlockFeedback(result, riskResult);
}

function writePostToolWarnFeedback(
  result: unknown,
  contextResult: Awaited<ReturnType<typeof evaluateContextTouchedPaths>>,
  riskResult: Awaited<ReturnType<typeof evaluateRiskToolResult>>,
): void {
  writeHookJson({
    systemMessage: combineHookMessages([
      `${renderPolicyDecisionReason(result)} Side effects may already have happened; inspect and repair if needed.`,
      renderRiskMessages(riskResult),
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
  riskResult: Awaited<ReturnType<typeof evaluateRiskToolResult>>,
): void {
  const riskMessage = renderRiskMessages(riskResult);
  if (contextResult.reminders.length === 0 && !riskMessage) return;
  if (contextResult.reminders.length === 0) {
    writePostToolRiskFeedback(riskMessage);
    return;
  }

  writeHookJson({
    systemMessage: combineHookMessages([
      riskMessage,
      renderContextReminderMessage(contextResult),
    ]),
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "Groundwork found new context reminders for touched paths. This is feedback, not synthetic prompt injection parity.",
    },
  });
}

function writePostToolRiskFeedback(riskMessage: string): void {
  writeHookJson({
    systemMessage: riskMessage,
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext:
        "Groundwork reported risk feedback after tool execution. This cannot undo side effects.",
    },
  });
}

function writePostToolBlockFeedback(
  result: unknown,
  riskResult: Awaited<ReturnType<typeof evaluateRiskToolResult>>,
): void {
  writeHookJson({
    decision: "block",
    reason: combineHookMessages([
      `${renderPolicyDecisionReason(result)} Side effects may already have happened; inspect and repair before continuing.`,
      renderRiskMessages(riskResult),
    ]),
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

function readRiskMessages(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const messages = (value as Record<string, unknown>)["messages"];
  return Array.isArray(messages)
    ? messages.filter((message): message is string => typeof message === "string" && message.length > 0)
    : [];
}

function renderRiskMessages(value: unknown): string {
  return combineHookMessages(readRiskMessages(value));
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
  });
}
