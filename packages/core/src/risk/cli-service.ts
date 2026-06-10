import path from "node:path";
import type { FrameworkJsonObject, FrameworkPendingToolCall } from "../kernel/state.ts";
import {
  updateSessionArtifactState,
  type SessionArtifactState,
} from "../session/artifacts.ts";
import type { GuardConfig } from "./rules.ts";
import {
  createRiskBlockOnceActionKey,
  createRiskPendingToolKey,
  createRiskFingerprint,
  evaluateRiskCommand,
  evaluateRiskCommandWithBlockOnce,
  markRiskBlockOnceExecuted,
  riskViolationMessage,
  riskExecutedAfterBlockOnceMessage,
  RISK_BLOCK_ONCE_ACTION,
  RISK_SERVICE,
  type RiskBlockOnceRecord,
} from "./service.ts";

export interface RiskEvaluateToolCallInput {
  root_dir?: string;
  session_id: string;
  call_id?: string;
  tool?: string;
  command: string;
  cwd?: string;
  config?: Partial<GuardConfig>;
}

export interface RiskEvaluateToolResultInput {
  root_dir?: string;
  session_id: string;
  call_id: string;
}

export async function evaluateRiskToolCall(input: RiskEvaluateToolCallInput) {
  if (input.tool && input.tool.trim().toLowerCase() !== "bash") {
    return {
      command: "risk evaluate-tool-call",
      decision: "allow" as const,
      effect: "no_risk" as const,
      session_id: input.session_id,
      call_id: input.call_id,
      tool: input.tool,
      violation: null,
      messages: [],
    };
  }

  const cwd = resolveRiskCwd(input);
  const classified = evaluateRiskCommand({
    command: input.command,
    config: input.config,
  });
  if (!classified.violation || classified.decision !== "block") {
    return {
      command: "risk evaluate-tool-call",
      ...classified,
      effect: "no_risk" as const,
      session_id: input.session_id,
      call_id: input.call_id,
      tool: "bash",
      messages:
        classified.violation && classified.decision === "warn"
          ? [riskViolationMessage(classified.violation)]
          : [],
    };
  }

  const fingerprint = createRiskFingerprint({
    command: input.command,
    cwd,
    violation: classified.violation,
  });

  const updated = await updateSessionArtifactState(input.root_dir, input.session_id, (state) => {
    const key = createRiskBlockOnceActionKey(fingerprint);
    const existingRecord = readRiskBlockOnceRecord(state, key);
    const result = evaluateRiskCommandWithBlockOnce({
      command: input.command,
      cwd,
      config: input.config,
      existingRecord,
    });

    if (!result.record) return result;

    writeRiskBlockOnceRecord(state, key, result.record);
    if (result.effect === "warn_after_block_once" && input.call_id) {
      state.session.pendingTools.calls[createRiskPendingToolKey(input.call_id)] =
        createRiskPendingTool(input.call_id, result.record);
    }
    return result;
  });

  return {
    command: "risk evaluate-tool-call",
    session_id: input.session_id,
    call_id: input.call_id,
    tool: "bash",
    ...updated.result,
  };
}

export async function evaluateRiskToolResult(input: RiskEvaluateToolResultInput) {
  const updated = await updateSessionArtifactState(input.root_dir, input.session_id, (state) => {
    return applyRiskToolResultState(state, input);
  });

  return updated.result;
}

function applyRiskToolResultState(
  state: SessionArtifactState,
  input: RiskEvaluateToolResultInput,
) {
  const pendingKey = createRiskPendingToolKey(input.call_id);
  const pending = state.session.pendingTools.calls[pendingKey];
  if (!pending) return riskToolResultIdle(input);

  delete state.session.pendingTools.calls[pendingKey];
  const fingerprint = readPendingRiskFingerprint(pending);
  if (!fingerprint) return riskToolResultMissing(input, "missing a fingerprint");

  const actionKey = createRiskBlockOnceActionKey(fingerprint);
  const existingRecord = readRiskBlockOnceRecord(state, actionKey);
  if (!existingRecord) return riskToolResultMissing(input, "had no matching block-once record");

  const record = markRiskBlockOnceExecuted(existingRecord, new Date().toISOString());
  writeRiskBlockOnceRecord(state, actionKey, record, { incrementCount: false });
  return {
    command: "risk evaluate-tool-result",
    decision: "warn" as const,
    effect: "warn_after_block_once" as const,
    session_id: input.session_id,
    call_id: input.call_id,
    fingerprint,
    record,
    messages: [riskExecutedAfterBlockOnceMessage(record)],
    recorded: true,
  };
}

function riskToolResultIdle(input: RiskEvaluateToolResultInput) {
  return {
    command: "risk evaluate-tool-result",
    decision: "allow" as const,
    effect: "no_risk" as const,
    session_id: input.session_id,
    call_id: input.call_id,
    messages: [],
    recorded: false,
  };
}

function riskToolResultMissing(input: RiskEvaluateToolResultInput, reason: string) {
  return {
    command: "risk evaluate-tool-result",
    decision: "warn" as const,
    effect: "warn_after_block_once" as const,
    session_id: input.session_id,
    call_id: input.call_id,
    messages: [`[groundwork:risk] Risk execution report ${reason}.`],
    recorded: false,
  };
}

function readRiskBlockOnceRecord(
  state: SessionArtifactState,
  actionKey: string,
): RiskBlockOnceRecord | null {
  const metadata = state.actions[actionKey]?.metadata;
  if (!metadata || typeof metadata.record !== "object" || Array.isArray(metadata.record)) {
    return null;
  }
  return metadata.record as unknown as RiskBlockOnceRecord;
}

function writeRiskBlockOnceRecord(
  state: SessionArtifactState,
  actionKey: string,
  record: RiskBlockOnceRecord,
  options: { incrementCount?: boolean } = {},
): void {
  const now = record.lastSeenAt;
  const existing = state.actions[actionKey];
  state.actions[actionKey] = {
    source: RISK_SERVICE,
    action: RISK_BLOCK_ONCE_ACTION,
    firstSeenAt: existing?.firstSeenAt ?? record.firstBlockedAt,
    lastSeenAt: now,
    count: (existing?.count ?? 0) + (options.incrementCount === false ? 0 : 1),
    metadata: {
      record: record as unknown as FrameworkJsonObject,
    },
  };
}

function createRiskPendingTool(
  callID: string,
  record: RiskBlockOnceRecord,
): FrameworkPendingToolCall {
  return {
    callID,
    toolName: "bash",
    phase: "after",
    capturedAt: record.lastSeenAt,
    args: {
      command_sha256: record.commandHash,
      command_preview: record.commandPreview,
    },
    targets: [],
    data: {
      source: RISK_SERVICE,
      fingerprint: record.fingerprint,
      ruleId: record.ruleId,
      severity: record.severity,
    },
  };
}

function readPendingRiskFingerprint(pending: FrameworkPendingToolCall): string | undefined {
  return typeof pending.data?.fingerprint === "string" ? pending.data.fingerprint : undefined;
}

function resolveRiskCwd(input: Pick<RiskEvaluateToolCallInput, "cwd" | "root_dir">): string {
  return path.resolve(input.cwd ?? input.root_dir ?? process.cwd());
}
