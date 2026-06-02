import type {
  FrameworkCacheBucket,
  FrameworkCacheEntry,
  FrameworkJsonObject,
  FrameworkJsonValue,
  FrameworkSessionKernelState,
} from "./state.ts";

export {
  applyFrameworkCollectionBudget,
  applyFrameworkEvidenceBudget,
  applyFrameworkPromptBudget,
  FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS,
  truncateFrameworkTextByBytes,
} from "./budget.ts";
export type {
  ApplyFrameworkBudgetOptions,
  FrameworkBudgetBound,
  FrameworkBudgetResult,
} from "./budget.ts";

export const FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS = Object.freeze({
  syntheticInjections: "synthetic-injections",
  frameworkActions: "framework-actions",
} as const);

export interface RememberFrameworkSyntheticInjectionOptions {
  now: string;
  source: string;
  text: string;
  variant?: string;
  metadata?: FrameworkJsonObject;
}

export interface CreateFrameworkActionDedupeKeyOptions {
  source: string;
  action: string;
  parts?: readonly unknown[];
}

export interface RememberFrameworkActionOptions extends CreateFrameworkActionDedupeKeyOptions {
  now: string;
  metadata?: FrameworkJsonObject;
}

export interface FrameworkDedupeHit {
  key: string;
  duplicate: boolean;
  entry: FrameworkCacheEntry;
}

function cloneJsonValue<T extends FrameworkJsonValue | undefined>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function cloneJsonObject<T extends FrameworkJsonObject | undefined>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function ensureCacheBucket(
  state: FrameworkSessionKernelState,
  bucketName: string,
): FrameworkCacheBucket {
  const existing = state.caches.buckets[bucketName];
  if (existing) {
    return existing;
  }

  const created: FrameworkCacheBucket = { entries: {} };
  state.caches.buckets[bucketName] = created;
  return created;
}

function stableDedupePart(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? `${value}` : "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableDedupePart(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) => {
        const nextValue = stableDedupePart(record[key]);
        return nextValue ? [`${key}:${nextValue}`] : [];
      });
    return `{${entries.join(",")}}`;
  }

  return String(value);
}

function readDedupeHits(entry: FrameworkCacheEntry | null): number {
  if (!entry?.value || Array.isArray(entry.value) || typeof entry.value !== "object") {
    return 0;
  }

  const hits = (entry.value as { hits?: unknown }).hits;
  return typeof hits === "number" && Number.isFinite(hits) ? Math.max(0, Math.floor(hits)) : 0;
}

function readDedupeFirstSeenAt(entry: FrameworkCacheEntry | null): string | undefined {
  if (!entry?.value || Array.isArray(entry.value) || typeof entry.value !== "object") {
    return undefined;
  }

  const firstSeenAt = (entry.value as { firstSeenAt?: unknown }).firstSeenAt;
  return typeof firstSeenAt === "string" ? firstSeenAt : undefined;
}

function rememberFrameworkDedupeKey(
  state: FrameworkSessionKernelState,
  params: {
    bucket: string;
    scope: string;
    key: string;
    now: string;
    metadata?: FrameworkJsonObject;
  },
): FrameworkDedupeHit {
  const existing = getFrameworkCacheEntry(state, params.bucket, params.key);
  const entry = setFrameworkCacheEntry(state, {
    bucket: params.bucket,
    key: params.key,
    now: params.now,
    value: {
      scope: params.scope,
      key: params.key,
      hits: readDedupeHits(existing) + 1,
      firstSeenAt: readDedupeFirstSeenAt(existing) ?? params.now,
      lastSeenAt: params.now,
    },
    metadata: params.metadata,
  });

  return {
    key: params.key,
    duplicate: existing !== null,
    entry,
  };
}

export function getFrameworkCacheEntry(
  state: FrameworkSessionKernelState,
  bucket: string,
  key: string,
): FrameworkCacheEntry | null {
  const entry = state.caches.buckets[bucket]?.entries[key];
  return entry ? structuredClone(entry) : null;
}

export function setFrameworkCacheEntry(
  state: FrameworkSessionKernelState,
  options: {
    bucket: string;
    key: string;
    value: FrameworkJsonValue;
    now: string;
    expiresAt?: string;
    metadata?: FrameworkJsonObject;
  },
): FrameworkCacheEntry {
  const entry: FrameworkCacheEntry = {
    value: cloneJsonValue(options.value) as FrameworkJsonValue,
    updatedAt: options.now,
    expiresAt: options.expiresAt,
    metadata: cloneJsonObject(options.metadata),
  };

  ensureCacheBucket(state, options.bucket).entries[options.key] = entry;
  state.updatedAt = options.now;
  return structuredClone(entry);
}

export function clearFrameworkCacheEntry(
  state: FrameworkSessionKernelState,
  options: {
    bucket: string;
    key: string;
    now: string;
  },
): boolean {
  const bucket = state.caches.buckets[options.bucket];
  if (!bucket || !(options.key in bucket.entries)) {
    return false;
  }

  delete bucket.entries[options.key];
  if (Object.keys(bucket.entries).length === 0) {
    delete state.caches.buckets[options.bucket];
  }
  state.updatedAt = options.now;
  return true;
}

export function createFrameworkDedupeKey(scope: string, parts: readonly unknown[] = []): string {
  const normalizedScope = scope.trim() || "framework";
  const normalizedParts = parts
    .map((part) => stableDedupePart(part))
    .filter((part) => part.length > 0);
  return [normalizedScope, ...normalizedParts].join("::");
}

export function createFrameworkSyntheticInjectionDedupeKey(
  options: Pick<RememberFrameworkSyntheticInjectionOptions, "source" | "text" | "variant">,
): string {
  return createFrameworkDedupeKey("synthetic-injection", [
    options.source,
    options.variant,
    options.text,
  ]);
}

export function createFrameworkActionDedupeKey(
  options: CreateFrameworkActionDedupeKeyOptions,
): string {
  return createFrameworkDedupeKey("framework-action", [
    options.source,
    options.action,
    ...(options.parts ?? []),
  ]);
}

export function rememberFrameworkSyntheticInjection(
  state: FrameworkSessionKernelState,
  options: RememberFrameworkSyntheticInjectionOptions,
): FrameworkDedupeHit {
  return rememberFrameworkDedupeKey(state, {
    bucket: FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS.syntheticInjections,
    scope: "synthetic-injection",
    key: createFrameworkSyntheticInjectionDedupeKey(options),
    now: options.now,
    metadata: {
      source: options.source,
      variant: options.variant,
      ...(options.metadata ? { context: cloneJsonObject(options.metadata) } : {}),
    },
  });
}

export function rememberFrameworkAction(
  state: FrameworkSessionKernelState,
  options: RememberFrameworkActionOptions,
): FrameworkDedupeHit {
  return rememberFrameworkDedupeKey(state, {
    bucket: FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS.frameworkActions,
    scope: "framework-action",
    key: createFrameworkActionDedupeKey(options),
    now: options.now,
    metadata: {
      source: options.source,
      action: options.action,
      ...(options.metadata ? { context: cloneJsonObject(options.metadata) } : {}),
    },
  });
}
