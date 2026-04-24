export type FrameworkJsonPrimitive = string | number | boolean | null;
export type FrameworkJsonArray = FrameworkJsonValue[];
export type FrameworkJsonValue = FrameworkJsonPrimitive | FrameworkJsonObject | FrameworkJsonArray;

export interface FrameworkJsonObject {
  [key: string]: FrameworkJsonValue | undefined;
}

export interface FrameworkModelRef {
  providerID: string;
  modelID: string;
}

export interface FrameworkPromptContext {
  messageID?: string;
  role?: string;
  agent?: string;
  model?: FrameworkModelRef;
  system?: string;
  variant?: string;
  tools?: FrameworkJsonObject;
}

export type FrameworkLockScope = "session" | "mutating-tools" | "tool-call" | "resource";

export interface FrameworkSessionLock {
  scope: FrameworkLockScope;
  reason: string;
  source: string;
  createdAt: string;
  expiresAt?: string;
  paths?: string[];
  metadata?: FrameworkJsonObject;
}

export interface FrameworkLockState {
  active: Record<string, FrameworkSessionLock>;
}

export interface FrameworkCacheEntry {
  value: FrameworkJsonValue;
  updatedAt: string;
  expiresAt?: string;
  metadata?: FrameworkJsonObject;
}

export interface FrameworkCacheBucket {
  entries: Record<string, FrameworkCacheEntry>;
}

export interface FrameworkCacheState {
  buckets: Record<string, FrameworkCacheBucket>;
}

export type FrameworkBudgetUnit = "count" | "bytes" | "milliseconds" | "tokens";

export interface FrameworkBudgetLedger {
  used: number;
  unit: FrameworkBudgetUnit;
  limit?: number;
  updatedAt: string;
  resetAt?: string;
  metadata?: FrameworkJsonObject;
}

export interface FrameworkBudgetState {
  ledgers: Record<string, FrameworkBudgetLedger>;
}

export interface FrameworkLineRange {
  startLine: number;
  endLine: number;
}

export type FrameworkToolTargetSourceKind = "argument" | "patch";

export type FrameworkToolTargetPatchAction = "add" | "update" | "delete" | "move";

export interface FrameworkToolTargetSource {
  kind: FrameworkToolTargetSourceKind;
  key: string;
  location: string;
  patchAction?: FrameworkToolTargetPatchAction;
}

export type FrameworkIgnoredToolTargetReason = "empty-path" | "unsafe-path" | "outside-root";

export interface FrameworkIgnoredToolTarget {
  path: string;
  reason: FrameworkIgnoredToolTargetReason;
  source: FrameworkToolTargetSource;
  beforePath?: string;
  afterPath?: string;
}

export interface FrameworkToolTarget {
  path: string;
  normalizedPath?: string;
  beforePath?: string;
  afterPath?: string;
  changedLineRanges?: FrameworkLineRange[];
  deletedLineRanges?: FrameworkLineRange[];
  source?: FrameworkToolTargetSource;
  metadata?: FrameworkJsonObject;
}

export interface FrameworkToolTargetExtraction {
  toolName: string;
  targets: FrameworkToolTarget[];
  ignoredTargets: FrameworkIgnoredToolTarget[];
}

export type FrameworkPendingToolPhase = "before" | "after";

export interface FrameworkPendingToolCall {
  callID: string;
  toolName: string;
  phase: FrameworkPendingToolPhase;
  capturedAt: string;
  args?: FrameworkJsonObject;
  targets: FrameworkToolTarget[];
  data?: FrameworkJsonObject;
}

export interface FrameworkPendingToolState {
  calls: Record<string, FrameworkPendingToolCall>;
}

export interface FrameworkSessionKernelState {
  sessionID: string;
  createdAt: string;
  updatedAt: string;
  promptContext: FrameworkPromptContext | null;
  locks: FrameworkLockState;
  caches: FrameworkCacheState;
  budgets: FrameworkBudgetState;
  pendingTools: FrameworkPendingToolState;
  metadata?: FrameworkJsonObject;
}

export interface CreateSessionKernelStateOptions {
  now?: string;
  promptContext?: FrameworkPromptContext | null;
  locks?: FrameworkLockState;
  caches?: FrameworkCacheState;
  budgets?: FrameworkBudgetState;
  pendingTools?: FrameworkPendingToolState;
  metadata?: FrameworkJsonObject;
}

export interface SessionKernelStore {
  create: (
    sessionID: string,
    options?: Omit<CreateSessionKernelStateOptions, "now">,
  ) => FrameworkSessionKernelState;
  get: (sessionID: string) => FrameworkSessionKernelState | null;
  set: (state: FrameworkSessionKernelState) => FrameworkSessionKernelState;
  cleanup: (sessionID: string) => boolean;
  cleanupMany: (sessionIDs: readonly string[]) => number;
  clear: () => void;
  snapshot: () => FrameworkSessionKernelState[];
  size: () => number;
}

type NowProvider = () => string;

const defaultNow: NowProvider = () => new Date().toISOString();

function cloneJsonValue(value: FrameworkJsonValue | undefined): FrameworkJsonValue | undefined {
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item) as FrameworkJsonValue);
  }

  const cloned: FrameworkJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const nextEntry = cloneJsonValue(entry);
    if (nextEntry !== undefined) {
      cloned[key] = nextEntry;
    }
  }
  return cloned;
}

function cloneJsonObject(value: FrameworkJsonObject | undefined): FrameworkJsonObject | undefined {
  const cloned = cloneJsonValue(value);
  if (!cloned || Array.isArray(cloned) || typeof cloned !== "object") {
    return undefined;
  }
  return cloned;
}

function cloneModelRef(model: FrameworkModelRef | undefined): FrameworkModelRef | undefined {
  if (!model) return undefined;

  return {
    providerID: model.providerID,
    modelID: model.modelID,
  };
}

function clonePromptContext(
  promptContext: FrameworkPromptContext | null | undefined,
): FrameworkPromptContext | null {
  if (!promptContext) return null;

  return {
    messageID: promptContext.messageID,
    role: promptContext.role,
    agent: promptContext.agent,
    model: cloneModelRef(promptContext.model),
    system: promptContext.system,
    variant: promptContext.variant,
    tools: cloneJsonObject(promptContext.tools),
  };
}

function cloneLockState(locks: FrameworkLockState | undefined): FrameworkLockState {
  const active: Record<string, FrameworkSessionLock> = {};

  for (const [key, lock] of Object.entries(locks?.active ?? {})) {
    active[key] = {
      scope: lock.scope,
      reason: lock.reason,
      source: lock.source,
      createdAt: lock.createdAt,
      expiresAt: lock.expiresAt,
      paths: lock.paths ? [...lock.paths] : undefined,
      metadata: cloneJsonObject(lock.metadata),
    };
  }

  return { active };
}

function cloneCacheState(caches: FrameworkCacheState | undefined): FrameworkCacheState {
  const buckets: Record<string, FrameworkCacheBucket> = {};

  for (const [bucketName, bucket] of Object.entries(caches?.buckets ?? {})) {
    const entries: Record<string, FrameworkCacheEntry> = {};

    for (const [entryKey, entry] of Object.entries(bucket.entries)) {
      entries[entryKey] = {
        value: cloneJsonValue(entry.value) as FrameworkJsonValue,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt,
        metadata: cloneJsonObject(entry.metadata),
      };
    }

    buckets[bucketName] = { entries };
  }

  return { buckets };
}

function cloneBudgetState(budgets: FrameworkBudgetState | undefined): FrameworkBudgetState {
  const ledgers: Record<string, FrameworkBudgetLedger> = {};

  for (const [budgetName, ledger] of Object.entries(budgets?.ledgers ?? {})) {
    ledgers[budgetName] = {
      used: ledger.used,
      unit: ledger.unit,
      limit: ledger.limit,
      updatedAt: ledger.updatedAt,
      resetAt: ledger.resetAt,
      metadata: cloneJsonObject(ledger.metadata),
    };
  }

  return { ledgers };
}

function cloneLineRanges(
  ranges: FrameworkLineRange[] | undefined,
): FrameworkLineRange[] | undefined {
  return ranges?.map((range) => ({
    startLine: range.startLine,
    endLine: range.endLine,
  }));
}

function cloneToolTargetSource(
  source: FrameworkToolTargetSource | undefined,
): FrameworkToolTargetSource | undefined {
  if (!source) return undefined;

  return {
    kind: source.kind,
    key: source.key,
    location: source.location,
    patchAction: source.patchAction,
  };
}

function cloneToolTargets(targets: FrameworkToolTarget[]): FrameworkToolTarget[] {
  return targets.map((target) => ({
    path: target.path,
    normalizedPath: target.normalizedPath,
    beforePath: target.beforePath,
    afterPath: target.afterPath,
    changedLineRanges: cloneLineRanges(target.changedLineRanges),
    deletedLineRanges: cloneLineRanges(target.deletedLineRanges),
    source: cloneToolTargetSource(target.source),
    metadata: cloneJsonObject(target.metadata),
  }));
}

function clonePendingToolState(
  pendingTools: FrameworkPendingToolState | undefined,
): FrameworkPendingToolState {
  const calls: Record<string, FrameworkPendingToolCall> = {};

  for (const [callID, call] of Object.entries(pendingTools?.calls ?? {})) {
    calls[callID] = {
      callID: call.callID,
      toolName: call.toolName,
      phase: call.phase,
      capturedAt: call.capturedAt,
      args: cloneJsonObject(call.args),
      targets: cloneToolTargets(call.targets),
      data: cloneJsonObject(call.data),
    };
  }

  return { calls };
}

function normalizeSessionKernelState(
  state: FrameworkSessionKernelState,
): FrameworkSessionKernelState {
  return {
    sessionID: state.sessionID,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    promptContext: clonePromptContext(state.promptContext),
    locks: cloneLockState(state.locks),
    caches: cloneCacheState(state.caches),
    budgets: cloneBudgetState(state.budgets),
    pendingTools: clonePendingToolState(state.pendingTools),
    metadata: cloneJsonObject(state.metadata),
  };
}

export function createSessionKernelState(
  sessionID: string,
  options: CreateSessionKernelStateOptions = {},
): FrameworkSessionKernelState {
  const timestamp = options.now ?? defaultNow();

  return {
    sessionID,
    createdAt: timestamp,
    updatedAt: timestamp,
    promptContext: clonePromptContext(options.promptContext),
    locks: cloneLockState(options.locks),
    caches: cloneCacheState(options.caches),
    budgets: cloneBudgetState(options.budgets),
    pendingTools: clonePendingToolState(options.pendingTools),
    metadata: cloneJsonObject(options.metadata),
  };
}

export function createSessionKernelStore(options?: { now?: NowProvider }): SessionKernelStore {
  const now = options?.now ?? defaultNow;
  const sessions = new Map<string, FrameworkSessionKernelState>();

  return {
    create(sessionID, seed = {}) {
      const existing = sessions.get(sessionID);
      if (existing) {
        return normalizeSessionKernelState(existing);
      }

      const created = createSessionKernelState(sessionID, {
        ...seed,
        now: now(),
      });
      sessions.set(sessionID, created);
      return normalizeSessionKernelState(created);
    },
    get(sessionID) {
      const session = sessions.get(sessionID);
      return session ? normalizeSessionKernelState(session) : null;
    },
    set(state) {
      const previous = sessions.get(state.sessionID);
      const next = normalizeSessionKernelState({
        ...state,
        createdAt: previous?.createdAt ?? state.createdAt,
        updatedAt: now(),
      });
      sessions.set(state.sessionID, next);
      return normalizeSessionKernelState(next);
    },
    cleanup(sessionID) {
      return sessions.delete(sessionID);
    },
    cleanupMany(sessionIDs) {
      let removed = 0;
      for (const sessionID of sessionIDs) {
        if (sessions.delete(sessionID)) {
          removed += 1;
        }
      }
      return removed;
    },
    clear() {
      sessions.clear();
    },
    snapshot() {
      return Array.from(sessions.values())
        .map((state) => normalizeSessionKernelState(state))
        .sort((left, right) => left.sessionID.localeCompare(right.sessionID));
    },
    size() {
      return sessions.size;
    },
  };
}

export function cleanupSessionKernelState(
  store: Pick<SessionKernelStore, "cleanup">,
  sessionID: string,
): boolean {
  return store.cleanup(sessionID);
}

export function cleanupSessionKernelStates(
  store: Pick<SessionKernelStore, "cleanupMany" | "clear" | "size">,
  sessionIDs?: readonly string[],
): number {
  if (sessionIDs !== undefined) {
    return store.cleanupMany(sessionIDs);
  }

  const removed = store.size();
  store.clear();
  return removed;
}
