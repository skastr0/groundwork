import type {
  FrameworkBudgetUnit,
  FrameworkCacheBucket,
  FrameworkCacheEntry,
  FrameworkJsonObject,
  FrameworkJsonValue,
  FrameworkSessionKernelState,
} from "./state.ts";

export const FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS = Object.freeze({
  promptItems: "prompt-items",
  promptBytes: "prompt-bytes",
  evidenceItems: "evidence-items",
  evidenceBytes: "evidence-bytes",
} as const);

export const FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS = Object.freeze({
  syntheticInjections: "synthetic-injections",
  frameworkActions: "framework-actions",
} as const);

export interface FrameworkBudgetBound {
  returned: number;
  limit: number;
  truncated: boolean;
}

export interface FrameworkBudgetResult<TItem> {
  items: TItem[];
  bounds: {
    items: FrameworkBudgetBound;
    bytes: FrameworkBudgetBound;
  };
}

export interface ApplyFrameworkBudgetOptions<TItem> {
  now: string;
  itemLimit: number;
  byteLimit: number;
  itemLedgerKey: string;
  byteLedgerKey: string;
  getSize: (item: TItem) => number;
  truncateItem?: (item: TItem, maxBytes: number) => TItem | null;
  metadata?: FrameworkJsonObject;
}

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

function normalizeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
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

function updateBudgetLedger(
  state: FrameworkSessionKernelState,
  params: {
    ledgerKey: string;
    used: number;
    limit: number;
    unit: FrameworkBudgetUnit;
    now: string;
    metadata?: FrameworkJsonObject;
  },
): void {
  state.budgets.ledgers[params.ledgerKey] = {
    used: params.used,
    limit: params.limit,
    unit: params.unit,
    updatedAt: params.now,
    metadata: cloneJsonObject(params.metadata),
  };
  state.updatedAt = params.now;
}

function createBudgetMetadata(params: {
  requestedItems: number;
  returnedItems: number;
  itemTruncated: boolean;
  byteTruncated: boolean;
  context?: FrameworkJsonObject;
}): FrameworkJsonObject {
  const metadata: FrameworkJsonObject = {
    requestedItems: params.requestedItems,
    returnedItems: params.returnedItems,
    itemTruncated: params.itemTruncated,
    byteTruncated: params.byteTruncated,
  };

  if (params.context) {
    metadata.context = cloneJsonObject(params.context);
  }

  return metadata;
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

function collectTextWithinByteBudget(value: string, maxBytes: number): string {
  let collected = "";

  for (const character of value) {
    const nextValue = `${collected}${character}`;
    if (Buffer.byteLength(nextValue, "utf8") > maxBytes) {
      break;
    }
    collected = nextValue;
  }

  return collected;
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

export function truncateFrameworkTextByBytes(value: string, maxBytes: number): string {
  const limit = normalizeCount(maxBytes);
  const trimmed = value.trim();

  if (!trimmed || limit === 0) {
    return "";
  }

  if (Buffer.byteLength(trimmed, "utf8") <= limit) {
    return trimmed;
  }

  const suffix = "...";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (suffixBytes >= limit) {
    return collectTextWithinByteBudget(trimmed, limit);
  }

  const prefix = collectTextWithinByteBudget(trimmed, limit - suffixBytes).trimEnd();
  return prefix ? `${prefix}${suffix}` : collectTextWithinByteBudget(trimmed, limit);
}

export function applyFrameworkCollectionBudget<TItem>(
  state: FrameworkSessionKernelState,
  items: readonly TItem[],
  options: ApplyFrameworkBudgetOptions<TItem>,
): FrameworkBudgetResult<TItem> {
  const itemLimit = normalizeCount(options.itemLimit);
  const byteLimit = normalizeCount(options.byteLimit);
  const boundedItems: TItem[] = [];
  let usedBytes = 0;
  let byteTruncated = false;

  for (const item of items) {
    if (boundedItems.length >= itemLimit) {
      break;
    }

    const size = normalizeCount(options.getSize(item));
    if (usedBytes + size <= byteLimit) {
      boundedItems.push(item);
      usedBytes += size;
      continue;
    }

    const remainingBytes = Math.max(0, byteLimit - usedBytes);
    if (options.truncateItem && remainingBytes > 0) {
      const truncatedItem = options.truncateItem(item, remainingBytes);
      if (truncatedItem !== null) {
        const truncatedSize = normalizeCount(options.getSize(truncatedItem));
        if (truncatedSize > 0 && truncatedSize <= remainingBytes) {
          boundedItems.push(truncatedItem);
          usedBytes += truncatedSize;
        }
      }
    }

    byteTruncated = true;
    break;
  }

  const itemTruncated = boundedItems.length < items.length;
  const metadata = createBudgetMetadata({
    requestedItems: items.length,
    returnedItems: boundedItems.length,
    itemTruncated,
    byteTruncated,
    context: options.metadata,
  });

  updateBudgetLedger(state, {
    ledgerKey: options.itemLedgerKey,
    used: boundedItems.length,
    limit: itemLimit,
    unit: "count",
    now: options.now,
    metadata,
  });
  updateBudgetLedger(state, {
    ledgerKey: options.byteLedgerKey,
    used: usedBytes,
    limit: byteLimit,
    unit: "bytes",
    now: options.now,
    metadata,
  });

  return {
    items: boundedItems,
    bounds: {
      items: {
        returned: boundedItems.length,
        limit: itemLimit,
        truncated: itemTruncated,
      },
      bytes: {
        returned: usedBytes,
        limit: byteLimit,
        truncated: byteTruncated,
      },
    },
  };
}

export function applyFrameworkPromptBudget<TItem>(
  state: FrameworkSessionKernelState,
  items: readonly TItem[],
  options: Omit<ApplyFrameworkBudgetOptions<TItem>, "itemLedgerKey" | "byteLedgerKey">,
): FrameworkBudgetResult<TItem> {
  return applyFrameworkCollectionBudget(state, items, {
    ...options,
    itemLedgerKey: FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.promptItems,
    byteLedgerKey: FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.promptBytes,
  });
}

export function applyFrameworkEvidenceBudget<TItem>(
  state: FrameworkSessionKernelState,
  items: readonly TItem[],
  options: Omit<ApplyFrameworkBudgetOptions<TItem>, "itemLedgerKey" | "byteLedgerKey">,
): FrameworkBudgetResult<TItem> {
  return applyFrameworkCollectionBudget(state, items, {
    ...options,
    itemLedgerKey: FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.evidenceItems,
    byteLedgerKey: FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.evidenceBytes,
  });
}
