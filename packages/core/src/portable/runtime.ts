/**
 * Harness-neutral Groundwork hook decisions backed by durable session artifacts.
 * Prism hooks (and any thin harness adapter) call these; they never hold in-memory session kernels.
 */
import { evaluateContextTouchedPaths } from "../context/cli-service.ts";
import {
  acceptPolicyOverride,
  evaluatePolicyToolCall,
  evaluatePolicyToolResult,
} from "../policy/cli-service.ts";
import { configFromEnv } from "../risk/rules.ts";
import { evaluateRiskCommand } from "../risk/service.ts";
import {
  evaluateRiskToolCall,
  evaluateRiskToolResult,
  recordRiskToolPending,
} from "../risk/cli-service.ts";
import { markSessionSkillsLoaded } from "../session/artifacts.ts";

export type PortableContinue = {
  decision: "continue";
  systemMessage?: string;
  additionalContext?: string;
};

export type PortableBlock = {
  decision: "block";
  message: string;
  systemMessage?: string;
};

export type PortableHookResult = PortableContinue | PortableBlock;

export type PortableSessionStartInput = {
  rootDir?: string;
  sessionId?: string;
};

export type PortablePromptSubmitInput = {
  rootDir?: string;
  sessionId?: string;
  prompt: string;
};

export type PortableToolBeforeInput = {
  rootDir?: string;
  sessionId?: string;
  callId?: string;
  toolName: string;
  args?: Record<string, unknown>;
};

export type PortableToolAfterInput = {
  rootDir?: string;
  sessionId?: string;
  callId: string;
  toolName?: string;
  args?: Record<string, unknown>;
};

export type PortablePermissionRequestInput = {
  rootDir?: string;
  sessionId?: string;
  callId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
};

const MUTATING_TOOL_ALIASES = new Set([
  "bash",
  "shell",
  "apply_patch",
  "edit",
  "write",
  "edit_file",
  "strreplace",
  "create",
  "delete",
  "move",
  "notebookedit",
]);

export function sessionStartResult(_input: PortableSessionStartInput = {}): PortableContinue {
  return {
    decision: "continue",
    additionalContext: [
      "Groundwork is active for policy, context, provenance, and risk feedback.",
      "Treat Groundwork hook feedback as repository guardrail context and address any reported policy or inherited-instruction issues.",
      "Risk is block-once for destructive shell: first match blocks; exact retry warns and is reported after execution.",
    ].join("\n"),
  };
}

export async function promptSubmitResult(
  input: PortablePromptSubmitInput,
): Promise<PortableContinue> {
  const sessionId = input.sessionId;
  if (!sessionId) return { decision: "continue" };

  const commands = parsePolicyPromptCommands(input.prompt);
  if (commands.length === 0) return { decision: "continue" };

  for (const command of commands) {
    if (command.type === "override") {
      await acceptPolicyOverride({
        root_dir: input.rootDir,
        session_id: sessionId,
        reason: command.reason,
      });
    } else {
      await markSessionSkillsLoaded({
        root_dir: input.rootDir,
        session_id: sessionId,
        skills: command.skills,
      });
    }
  }

  return {
    decision: "continue",
    additionalContext: "[groundwork:policy] Policy command state was recorded.",
  };
}

export async function toolBeforeResult(
  input: PortableToolBeforeInput,
): Promise<PortableHookResult> {
  const tool = normalizePolicyToolName(input.toolName);
  if (!shouldEvaluateTool(tool, input.toolName)) {
    return { decision: "continue" };
  }

  const risk = await evaluatePreToolRisk(input, tool);
  if (risk.kind === "deny") {
    return { decision: "block", message: risk.reason };
  }

  const sessionId = input.sessionId;
  if (!sessionId) {
    const message = combineHookMessages(risk.messages);
    return message
      ? { decision: "continue", systemMessage: message }
      : { decision: "continue" };
  }

  const policy = await evaluatePolicyToolCall({
    root_dir: input.rootDir,
    directory: input.rootDir,
    session_id: sessionId,
    tool,
    call_id: input.callId,
    args: input.args,
  });

  if (isPolicyBlock(policy)) {
    return {
      decision: "block",
      message: combineHookMessages([renderPolicyDecisionReason(policy), ...risk.messages]),
    };
  }

  if (risk.pendingRisk && input.callId) {
    await recordRiskToolPending({
      root_dir: input.rootDir,
      session_id: sessionId,
      call_id: input.callId,
      fingerprint: risk.pendingRisk.fingerprint,
    });
  }

  const message = combineHookMessages([
    isPolicyWarn(policy) ? renderPolicyDecisionReason(policy) : undefined,
    ...risk.messages,
  ]);
  return message
    ? { decision: "continue", systemMessage: message }
    : { decision: "continue" };
}

export async function toolAfterResult(
  input: PortableToolAfterInput,
): Promise<PortableContinue> {
  const sessionId = input.sessionId;
  if (!sessionId) return { decision: "continue" };

  const tool = input.toolName ? normalizePolicyToolName(input.toolName) : undefined;
  const riskResult = await evaluateRiskToolResult({
    root_dir: input.rootDir,
    session_id: sessionId,
    call_id: input.callId,
  });
  const policyResult = await evaluatePolicyToolResult({
    root_dir: input.rootDir,
    session_id: sessionId,
    call_id: input.callId,
    tool,
  });
  const contextResult = await evaluateContextTouchedPaths({
    root_dir: input.rootDir,
    directory: input.rootDir,
    session_id: sessionId,
    tool,
    args: input.args,
  });

  if (isPolicyBlock(policyResult)) {
    return {
      decision: "continue",
      systemMessage: combineHookMessages([
        `${renderPolicyDecisionReason(policyResult)} Side effects may already have happened; inspect and repair before continuing.`,
        renderRiskMessages(riskResult),
      ]),
      additionalContext:
        "Groundwork policy reported post-tool feedback. This cannot undo side effects.",
    };
  }

  if (isPolicyWarn(policyResult)) {
    return {
      decision: "continue",
      systemMessage: combineHookMessages([
        `${renderPolicyDecisionReason(policyResult)} Side effects may already have happened; inspect and repair if needed.`,
        renderRiskMessages(riskResult),
        renderContextReminderMessage(contextResult),
      ]),
      additionalContext:
        "Groundwork reported non-blocking post-tool feedback. This cannot undo side effects.",
    };
  }

  const riskMessage = renderRiskMessages(riskResult);
  const contextMessage = renderContextReminderMessage(contextResult);
  if (!riskMessage && !contextMessage) return { decision: "continue" };

  return {
    decision: "continue",
    systemMessage: combineHookMessages([riskMessage, contextMessage]),
    additionalContext: contextMessage
      ? "Groundwork found new context reminders for touched paths."
      : "Groundwork reported risk feedback after tool execution.",
  };
}

export async function permissionRequestResult(
  input: PortablePermissionRequestInput,
): Promise<PortableHookResult> {
  const toolName = input.toolName ?? "";
  const tool = normalizePolicyToolName(toolName);
  if (tool !== "bash") return { decision: "continue" };

  const command = commandFromArgs(input.args);
  if (!command) return { decision: "continue" };

  const sessionId = input.sessionId;
  if (!sessionId) {
    const riskDecision = evaluateRiskCommand({
      command,
      config: configFromEnv(process.env),
    });
    if (!riskDecision.violation || riskDecision.decision !== "block") {
      return { decision: "continue" };
    }
    return {
      decision: "block",
      message:
        `[groundwork:risk] ${riskDecision.violation.reason} (rule: ${riskDecision.violation.ruleId}). ` +
        "No session_id was present, so block-once retry state could not be recorded.",
    };
  }

  const result = await evaluateRiskToolCall({
    root_dir: input.rootDir,
    session_id: sessionId,
    call_id: input.callId,
    tool: "bash",
    command,
    cwd: input.rootDir,
    config: configFromEnv(process.env),
    record_pending: false,
  });

  const message = renderRiskMessages(result);
  if (result.decision === "block") {
    return { decision: "block", message: message || "[groundwork:risk] Command blocked." };
  }

  return message
    ? {
        decision: "continue",
        systemMessage: message,
        additionalContext:
          "Groundwork risk is warning only here; it is not granting or denying the permission request.",
      }
    : { decision: "continue" };
}

type PreToolRiskResult =
  | { kind: "continue"; messages: string[]; pendingRisk?: { fingerprint: string } }
  | { kind: "deny"; reason: string };

async function evaluatePreToolRisk(
  input: PortableToolBeforeInput,
  tool: string,
): Promise<PreToolRiskResult> {
  if (tool !== "bash") return { kind: "continue", messages: [] };

  const command = commandFromArgs(input.args);
  if (!command) return { kind: "continue", messages: [] };

  const sessionId = input.sessionId;
  if (!sessionId) {
    const riskDecision = evaluateRiskCommand({
      command,
      config: configFromEnv(process.env),
    });
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
        "No session_id was present, so block-once retry state could not be recorded.",
    };
  }

  const result = await evaluateRiskToolCall({
    root_dir: input.rootDir,
    session_id: sessionId,
    call_id: input.callId,
    tool: "bash",
    command,
    cwd: input.rootDir,
    config: configFromEnv(process.env),
    record_pending: false,
  });

  if (result.decision === "block") {
    return { kind: "deny", reason: renderRiskMessages(result) || "[groundwork:risk] Command blocked." };
  }

  if (result.effect !== "warn_after_block_once" || typeof result.fingerprint !== "string") {
    return { kind: "continue", messages: readRiskMessages(result) };
  }

  if (!input.callId) {
    return {
      kind: "deny",
      reason: combineHookMessages([
        renderRiskMessages(result),
        "[groundwork:risk] Retry blocked because no tool call id was supplied for execution reporting.",
      ]),
    };
  }

  return {
    kind: "continue",
    messages: readRiskMessages(result),
    pendingRisk: { fingerprint: result.fingerprint },
  };
}

function shouldEvaluateTool(normalized: string, rawName: string): boolean {
  if (MUTATING_TOOL_ALIASES.has(normalized)) return true;
  const lower = rawName.toLowerCase();
  return (
    lower.includes("bash") ||
    lower.includes("shell") ||
    lower.includes("edit") ||
    lower.includes("write") ||
    lower.includes("apply_patch") ||
    lower.includes("strreplace")
  );
}

export function normalizePolicyToolName(toolName: string): string {
  const trimmed = toolName.trim();
  if (trimmed === "Bash" || trimmed === "bash" || /shell/i.test(trimmed)) return "bash";
  if (trimmed === "apply_patch" || trimmed === "ApplyPatch") return "edit";
  if (trimmed === "Edit" || trimmed === "Write" || trimmed === "StrReplace") {
    return trimmed.toLowerCase() === "strreplace" ? "edit" : trimmed.toLowerCase();
  }
  return trimmed.toLowerCase();
}

function commandFromArgs(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  const command = args.command ?? args.cmd ?? args.script;
  return typeof command === "string" ? command : undefined;
}

function isPolicyBlock(value: unknown): boolean {
  return readDecision(value) === "block";
}

function isPolicyWarn(value: unknown): boolean {
  return readDecision(value) === "warn";
}

function readDecision(value: unknown): string | undefined {
  return value && typeof value === "object"
    ? ((value as Record<string, unknown>).decision as string | undefined)
    : undefined;
}

function renderPolicyDecisionReason(value: unknown): string {
  const messages =
    value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).messages)
      ? ((value as Record<string, unknown>).messages as unknown[])
      : [];
  const firstText = messages
    .map((message) =>
      message && typeof message === "object"
        ? (message as Record<string, unknown>).text
        : undefined,
    )
    .find((text): text is string => typeof text === "string" && text.length > 0);
  return firstText ?? "[groundwork:policy] Policy check requested attention.";
}

function readRiskMessages(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const messages = (value as Record<string, unknown>).messages;
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

export function parsePolicyPromptCommands(prompt: string): ParsedPolicyPromptCommand[] {
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
