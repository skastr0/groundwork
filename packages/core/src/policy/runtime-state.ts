import { FrameworkEnforcementError } from "../layer/dispatcher.ts";
import type {
  FrameworkJsonObject,
  FrameworkSessionKernelState,
  SessionKernelStore,
} from "../kernel/state.ts";
import {
  MUTATING_TOOLS,
  POLICY_PENDING_OVERRIDE_LOCK_KEY,
  POLICY_RUNTIME_METADATA_KEY,
  POLICY_TERMINATION_LOCK_KEY,
  SERVICE,
  SEVERITY_ORDER,
  type PolicyHumanOverrideLock,
  type PolicyRuntimeState,
  type PolicySessionTermination,
} from "./runtime-types.ts";
import type { GuardrailSeverity } from "./config.ts";

export function asToolArgs(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function getOrCreateSessionState(
  sessionStore: SessionKernelStore,
  sessionID: string,
): FrameworkSessionKernelState {
  return sessionStore.get(sessionID) ?? sessionStore.create(sessionID);
}

export function createPolicyPendingToolKey(callID: string): string {
  return `${SERVICE}::${callID}`;
}

export function getPolicyRuntimeState(state: FrameworkSessionKernelState): PolicyRuntimeState {
  const rawRuntime =
    state.metadata && isRecord(state.metadata[POLICY_RUNTIME_METADATA_KEY])
      ? state.metadata[POLICY_RUNTIME_METADATA_KEY]
      : undefined;

  return {
    completedInjectOnlyRules: new Set(
      isStringArray(rawRuntime?.completedInjectOnlyRules)
        ? rawRuntime.completedInjectOnlyRules
        : [],
    ),
    confirmedSkills: new Set(
      isStringArray(rawRuntime?.confirmedSkills) ? rawRuntime.confirmedSkills : [],
    ),
    promptContextLoaded: rawRuntime?.promptContextLoaded === true,
  };
}

export function setPolicyRuntimeState(
  state: FrameworkSessionKernelState,
  runtimeState: PolicyRuntimeState,
): void {
  const metadata: FrameworkJsonObject = state.metadata ? structuredClone(state.metadata) : {};
  metadata[POLICY_RUNTIME_METADATA_KEY] = {
    completedInjectOnlyRules: [...runtimeState.completedInjectOnlyRules].sort(),
    confirmedSkills: [...runtimeState.confirmedSkills].sort(),
    promptContextLoaded: runtimeState.promptContextLoaded,
  };
  state.metadata = metadata;
}

export function getPendingHumanOverrideLock(
  state: FrameworkSessionKernelState,
): PolicyHumanOverrideLock | null {
  const lock = state.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY];
  if (!lock) {
    return null;
  }

  const ruleId =
    lock.metadata && typeof lock.metadata.ruleId === "string" ? lock.metadata.ruleId : lock.source;
  return {
    ruleId,
    message: lock.reason,
    paths: lock.paths ? [...lock.paths] : [],
    createdAt: lock.createdAt,
  };
}

export function setPendingHumanOverrideLock(
  state: FrameworkSessionKernelState,
  lock: PolicyHumanOverrideLock,
): void {
  state.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY] = {
    scope: "mutating-tools",
    reason: lock.message,
    source: SERVICE,
    createdAt: lock.createdAt,
    paths: [...lock.paths],
    metadata: {
      ruleId: lock.ruleId,
    },
  };
}

export function clearPendingHumanOverrideLock(state: FrameworkSessionKernelState): void {
  delete state.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY];
}

function getTerminationLock(state: FrameworkSessionKernelState): PolicySessionTermination | null {
  const lock = state.locks.active[POLICY_TERMINATION_LOCK_KEY];
  if (!lock) {
    return null;
  }

  const ruleId =
    lock.metadata && typeof lock.metadata.ruleId === "string" ? lock.metadata.ruleId : lock.source;
  return {
    ruleId,
    message: lock.reason,
    paths: lock.paths ? [...lock.paths] : [],
    createdAt: lock.createdAt,
  };
}

export function setTerminationLock(
  state: FrameworkSessionKernelState,
  termination: PolicySessionTermination,
): void {
  state.locks.active[POLICY_TERMINATION_LOCK_KEY] = {
    scope: "session",
    reason: termination.message,
    source: SERVICE,
    createdAt: termination.createdAt,
    paths: [...termination.paths],
    metadata: {
      ruleId: termination.ruleId,
    },
  };
}

export function enforceSessionStateGuards(
  state: FrameworkSessionKernelState,
  tool: string,
): void {
  const termination = getTerminationLock(state);
  if (termination) {
    throw new FrameworkEnforcementError({
      message: `[groundwork:policy] Session is terminated by rule '${termination.ruleId}'. Start a new session to continue.`,
      source: SERVICE,
      code: termination.ruleId,
    });
  }

  const pendingHumanOverride = getPendingHumanOverrideLock(state);
  if (pendingHumanOverride && MUTATING_TOOLS.has(tool)) {
    throw new FrameworkEnforcementError({
      message: `[groundwork:policy] Mutating tools are locked by rule '${pendingHumanOverride.ruleId}'. Provide human override via '/policy override <reason>' to continue.`,
      source: SERVICE,
      code: pendingHumanOverride.ruleId,
    });
  }
}

export function isBlockingSeverity(severity: GuardrailSeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER.block;
}

export function severityToLogLevel(severity: GuardrailSeverity): "info" | "warn" | "error" {
  if (severity === "advisory") return "info";
  if (severity === "warn") return "warn";
  return "error";
}
