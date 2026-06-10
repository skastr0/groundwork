import { createHash } from "node:crypto";
import {
  DEFAULT_GUARD_CONFIG,
  evaluateBashCommand,
  type GuardConfig,
  type GuardViolation,
} from "./rules.ts";

export const RISK_SERVICE = "groundwork-risk";
export const RISK_BLOCK_ONCE_ACTION = "risk-block-once";
export const RISK_PENDING_TOOL_PREFIX = `${RISK_SERVICE}::`;

export type RiskBlockOnceEffect =
  | "no_risk"
  | "blocked_once"
  | "warn_after_block_once";

export interface RiskBlockOnceRecord {
  fingerprint: string;
  ruleId: string;
  severity: GuardViolation["severity"];
  reason: string;
  cwd: string;
  commandHash: string;
  commandPreview: string;
  segmentHash: string;
  segmentPreview: string;
  firstBlockedAt: string;
  lastSeenAt: string;
  warningCount: number;
  executionCount: number;
  lastExecutedAt?: string;
}

export interface RiskCommandEvaluation {
  decision: "allow" | "warn" | "block";
  violation: GuardViolation | null;
  config: GuardConfig;
}

export interface RiskBlockOnceEvaluation extends RiskCommandEvaluation {
  effect: RiskBlockOnceEffect;
  fingerprint?: string;
  record?: RiskBlockOnceRecord;
  messages: string[];
}

export interface RiskFingerprintInput {
  command: string;
  cwd?: string;
  violation: GuardViolation;
}

export function evaluateRiskCommand(params: {
  command: string;
  config?: Partial<GuardConfig>;
}): RiskCommandEvaluation {
  const config: GuardConfig = {
    ...DEFAULT_GUARD_CONFIG,
    ...params.config,
  };
  if (config.mode === "off") {
    return {
      decision: "allow",
      violation: null,
      config,
    };
  }

  const decision = evaluateBashCommand(params.command, config);
  return {
    decision: decision.violation ? config.mode : "allow",
    violation: decision.violation,
    config,
  };
}

export function riskViolationMessage(violation: GuardViolation): string {
  return `[groundwork:risk] ${violation.reason} (rule: ${violation.ruleId})`;
}

export function evaluateRiskCommandWithBlockOnce(params: {
  command: string;
  cwd?: string;
  config?: Partial<GuardConfig>;
  existingRecord?: RiskBlockOnceRecord | null;
  now?: string;
}): RiskBlockOnceEvaluation {
  const evaluated = evaluateRiskCommand({
    command: params.command,
    config: params.config,
  });

  if (!evaluated.violation || evaluated.decision !== "block") {
    return {
      ...evaluated,
      effect: "no_risk",
      messages:
        evaluated.violation && evaluated.decision === "warn"
          ? [riskViolationMessage(evaluated.violation)]
          : [],
    };
  }

  const now = params.now ?? new Date().toISOString();
  const fingerprint = createRiskFingerprint({
    command: params.command,
    cwd: params.cwd,
    violation: evaluated.violation,
  });

  if (params.existingRecord) {
    const record = updateRiskBlockOnceRecord(params.existingRecord, now);
    return {
      ...evaluated,
      decision: "warn",
      effect: "warn_after_block_once",
      fingerprint,
      record,
      messages: [riskWarnAfterBlockOnceMessage(evaluated.violation)],
    };
  }

  const record = createRiskBlockOnceRecord({
    command: params.command,
    cwd: params.cwd,
    violation: evaluated.violation,
    fingerprint,
    now,
  });
  return {
    ...evaluated,
    effect: "blocked_once",
    fingerprint,
    record,
    messages: [riskBlockedOnceMessage(evaluated.violation)],
  };
}

export function createRiskFingerprint(input: RiskFingerprintInput): string {
  const payload = JSON.stringify({
    version: 1,
    cwd: normalizeRiskCwd(input.cwd),
    command: normalizeRiskCommandText(input.command),
    ruleId: input.violation.ruleId,
    segment: normalizeRiskCommandText(input.violation.segment),
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function createRiskBlockOnceActionKey(fingerprint: string): string {
  return `${RISK_SERVICE}:block-once:${fingerprint}`;
}

export function createRiskPendingToolKey(callID: string): string {
  return `${RISK_PENDING_TOOL_PREFIX}${callID}`;
}

export function createRiskBlockOnceRecord(params: {
  command: string;
  cwd?: string;
  violation: GuardViolation;
  fingerprint: string;
  now: string;
}): RiskBlockOnceRecord {
  return {
    fingerprint: params.fingerprint,
    ruleId: params.violation.ruleId,
    severity: params.violation.severity,
    reason: params.violation.reason,
    cwd: normalizeRiskCwd(params.cwd),
    commandHash: hashText(normalizeRiskCommandText(params.command)),
    commandPreview: truncateRiskText(normalizeRiskCommandText(params.command)),
    segmentHash: hashText(normalizeRiskCommandText(params.violation.segment)),
    segmentPreview: truncateRiskText(normalizeRiskCommandText(params.violation.segment)),
    firstBlockedAt: params.now,
    lastSeenAt: params.now,
    warningCount: 0,
    executionCount: 0,
  };
}

export function updateRiskBlockOnceRecord(
  record: RiskBlockOnceRecord,
  now: string,
): RiskBlockOnceRecord {
  return {
    ...record,
    lastSeenAt: now,
    warningCount: record.warningCount + 1,
  };
}

export function markRiskBlockOnceExecuted(
  record: RiskBlockOnceRecord,
  now: string,
): RiskBlockOnceRecord {
  return {
    ...record,
    lastSeenAt: now,
    lastExecutedAt: now,
    executionCount: record.executionCount + 1,
  };
}

export function riskBlockedOnceMessage(violation: GuardViolation): string {
  return `${riskViolationMessage(violation)}. Blocked once for this exact command in this session. A retry of the same command will continue with warning and execution reporting. Recommended: ask the user before retrying unless the destructive context is intentional.`;
}

export function riskWarnAfterBlockOnceMessage(violation: GuardViolation): string {
  return `${riskViolationMessage(violation)}. Proceeding after a prior block-once warning for this exact command. This remains potentially destructive and will be reported after execution.`;
}

export function riskExecutedAfterBlockOnceMessage(record: RiskBlockOnceRecord): string {
  return `[groundwork:risk] Unsafe command executed after prior block-once warning (rule: ${record.ruleId}, command_sha256: ${record.commandHash.slice(0, 12)}).`;
}

function normalizeRiskCommandText(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

function normalizeRiskCwd(value: string | undefined): string {
  return (value ?? "").trim();
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function truncateRiskText(value: string): string {
  const maxLength = 320;
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}
