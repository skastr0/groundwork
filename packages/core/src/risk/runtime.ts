import path from "node:path";
import { configFromEnv, type GuardConfig } from "./rules.ts";
import {
  createRiskBlockOnceActionKey,
  createRiskFingerprint,
  createRiskPendingToolKey,
  evaluateRiskCommand,
  evaluateRiskCommandWithBlockOnce,
  markRiskBlockOnceExecuted,
  riskExecutedAfterBlockOnceMessage,
  riskViolationMessage,
  truncateRiskText,
  RISK_BLOCK_ONCE_ACTION,
  RISK_SERVICE,
  type RiskBlockOnceRecord,
} from "./service.ts";
import {
  FrameworkEnforcementError,
  type GroundworkLayerHooks,
  type GroundworkLayerRegistration,
} from "../layer/dispatcher.ts";
import { createFrameworkSessionCleanupEventHook } from "../layer/session-cleanup.ts";
import {
  getFrameworkCacheEntry,
  setFrameworkCacheEntry,
} from "../kernel/helpers.ts";
import {
  createSessionKernelStore,
  type FrameworkJsonObject,
  type FrameworkPendingToolCall,
  type FrameworkSessionKernelState,
  type SessionKernelStore,
} from "../kernel/state.ts";
import { logFrameworkEvent } from "../logger/events.ts";
import type { FrameworkLogClient } from "../logger/index.ts";

const SERVICE = RISK_SERVICE;
const RISK_BLOCK_ONCE_CACHE_BUCKET = "risk-block-once";

type FrameworkRiskClient = FrameworkLogClient;

type RiskToolBeforeHook = NonNullable<
  GroundworkLayerHooks["tool.execute.before"]
>;
type RiskToolAfterHook = NonNullable<
  GroundworkLayerHooks["tool.execute.after"]
>;

interface RiskToolBeforeRuntime {
  client: FrameworkRiskClient;
  config: GuardConfig;
  rootDir: string;
  sessionStore: SessionKernelStore;
}

export interface CreateFrameworkRiskLayerOptions {
  client: FrameworkRiskClient;
  directory?: string;
  env?: NodeJS.ProcessEnv;
  ownSessionCleanup?: boolean;
  sessionStore?: SessionKernelStore;
  worktree?: string;
}

export async function createFrameworkRiskLayer(
  options: CreateFrameworkRiskLayerOptions,
): Promise<GroundworkLayerRegistration> {
  const config = configFromEnv(options.env);
  const rootDir = path.resolve(options.worktree ?? options.directory ?? process.cwd());
  const sessionStore = options.sessionStore ?? createSessionKernelStore();

  await logFrameworkEvent(options.client, SERVICE, "info", "Plugin initialized", {
    mode: config.mode,
    rootDir,
    includeExtendedRules: config.includeExtendedRules,
    allowTempRecursiveForceRm: config.allowTempRecursiveForceRm,
  });

  return {
    active: true,
    hooks: {
      "tool.execute.before": createRiskToolBeforeHook({
        client: options.client,
        config,
        rootDir,
        sessionStore,
      }),
      "tool.execute.after": createRiskToolAfterHook({
        client: options.client,
        sessionStore,
      }),
      ...(options.ownSessionCleanup ?? true
        ? { event: createFrameworkSessionCleanupEventHook(sessionStore) }
        : {}),
    },
  };
}

export function createRiskToolBeforeHook(params: {
  client: FrameworkRiskClient;
  config: GuardConfig;
  rootDir?: string;
  sessionStore?: SessionKernelStore;
}): RiskToolBeforeHook {
  const runtime: RiskToolBeforeRuntime = {
    client: params.client,
    config: params.config,
    rootDir: params.rootDir ?? process.cwd(),
    sessionStore: params.sessionStore ?? createSessionKernelStore(),
  };

  return async ({ tool, callID, sessionID }, { args }) => {
    await handleRiskToolBefore(runtime, tool, callID, sessionID, args);
  };
}

async function handleRiskToolBefore(
  runtime: RiskToolBeforeRuntime,
  tool: string,
  callID: string,
  sessionID: string,
  args: unknown,
): Promise<void> {
  if (tool !== "bash") return;
  if (runtime.config.mode === "off") return;

  const command = extractCommand(args);
  if (!command) return;

  const decision = evaluateRiskCommand({ command, config: runtime.config });
  if (!decision.violation) return;

  const cwd = resolveRiskCwd(args, runtime.rootDir);
  const state = getOrCreateRiskSessionState(runtime.sessionStore, sessionID);
  const fingerprint = createRiskFingerprint({ command, cwd, violation: decision.violation });
  const blockOnceDecision = evaluateRiskCommandWithBlockOnce({
    command,
    cwd,
    config: runtime.config,
    existingRecord: readRiskRecord(state, fingerprint),
  });
  persistRiskBlockOnceDecision(runtime.sessionStore, state, callID, tool, blockOnceDecision.record);

  await logFrameworkEvent(runtime.client, SERVICE, "warn", "Blocked potentially destructive command", {
    mode: runtime.config.mode,
    effect: blockOnceDecision.effect,
    callID,
    sessionID,
    ruleId: decision.violation.ruleId,
    severity: decision.violation.severity,
    command: truncateRiskText(command),
  });

  if (blockOnceDecision.decision === "warn") return;

  throw new FrameworkEnforcementError({
    message: blockOnceDecision.messages[0] ?? riskViolationMessage(decision.violation),
    source: SERVICE,
    code: decision.violation.ruleId,
  });
}

function persistRiskBlockOnceDecision(
  sessionStore: SessionKernelStore,
  state: FrameworkSessionKernelState,
  callID: string,
  tool: string,
  record: RiskBlockOnceRecord | undefined,
): void {
  if (!record) return;

  writeRiskRecord(state, record);
  if (record.warningCount > 0) {
    state.pendingTools.calls[createRiskPendingToolKey(callID)] = createRiskPendingTool(
      callID,
      tool,
      record,
    );
  }
  sessionStore.set(state);
}

export function createRiskToolAfterHook(params: {
  client: FrameworkRiskClient;
  sessionStore?: SessionKernelStore;
}): RiskToolAfterHook {
  const { client } = params;
  const sessionStore = params.sessionStore ?? createSessionKernelStore();

  return async ({ tool, callID, sessionID }) => {
    if (tool !== "bash") return;

    let state = sessionStore.get(sessionID);
    if (!state) return;

    const pendingKey = createRiskPendingToolKey(callID);
    const pending = state.pendingTools.calls[pendingKey];
    if (!pending) return;

    delete state.pendingTools.calls[pendingKey];
    const fingerprint =
      typeof pending.data?.fingerprint === "string" ? pending.data.fingerprint : undefined;
    if (!fingerprint) {
      sessionStore.set(state);
      return;
    }

    const record = readRiskRecord(state, fingerprint);
    if (!record) {
      sessionStore.set(state);
      return;
    }

    const executedRecord = markRiskBlockOnceExecuted(record, new Date().toISOString());
    writeRiskRecord(state, executedRecord);
    state = sessionStore.set(state);

    await logFrameworkEvent(
      client,
      SERVICE,
      "warn",
      "Unsafe command executed after prior block-once warning",
      {
        callID,
        sessionID,
        ruleId: executedRecord.ruleId,
        severity: executedRecord.severity,
        command: executedRecord.commandPreview,
        message: riskExecutedAfterBlockOnceMessage(executedRecord),
      },
    );
  };
}

function extractCommand(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const maybeCommand = (args as { command?: unknown }).command;
  return typeof maybeCommand === "string" ? maybeCommand : null;
}

function resolveRiskCwd(args: unknown, rootDir: string): string {
  if (!args || typeof args !== "object") return rootDir;
  const maybeCwd = (args as { cwd?: unknown }).cwd;
  return typeof maybeCwd === "string" && maybeCwd.trim().length > 0
    ? path.resolve(rootDir, maybeCwd)
    : rootDir;
}

function getOrCreateRiskSessionState(
  sessionStore: SessionKernelStore,
  sessionID: string,
): FrameworkSessionKernelState {
  return sessionStore.get(sessionID) ?? sessionStore.create(sessionID);
}

function readRiskRecord(
  state: FrameworkSessionKernelState,
  fingerprint: string,
): RiskBlockOnceRecord | null {
  const entry = getFrameworkCacheEntry(
    state,
    RISK_BLOCK_ONCE_CACHE_BUCKET,
    createRiskBlockOnceActionKey(fingerprint),
  );
  if (!entry?.value || typeof entry.value !== "object" || Array.isArray(entry.value)) {
    return null;
  }
  return entry.value as unknown as RiskBlockOnceRecord;
}

function writeRiskRecord(
  state: FrameworkSessionKernelState,
  record: RiskBlockOnceRecord,
): void {
  setFrameworkCacheEntry(state, {
    bucket: RISK_BLOCK_ONCE_CACHE_BUCKET,
    key: createRiskBlockOnceActionKey(record.fingerprint),
    now: record.lastSeenAt,
    value: record as unknown as FrameworkJsonObject,
    metadata: {
      source: SERVICE,
      action: RISK_BLOCK_ONCE_ACTION,
      ruleId: record.ruleId,
    },
  });
}

function createRiskPendingTool(
  callID: string,
  tool: string,
  record: RiskBlockOnceRecord,
): FrameworkPendingToolCall {
  return {
    callID,
    toolName: tool,
    phase: "after",
    capturedAt: record.lastSeenAt,
    args: {
      command_sha256: record.commandHash,
      command_preview: record.commandPreview,
    },
    targets: [],
    data: {
      source: SERVICE,
      fingerprint: record.fingerprint,
      ruleId: record.ruleId,
      severity: record.severity,
    },
  };
}
