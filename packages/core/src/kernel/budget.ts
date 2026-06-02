import type {
  FrameworkBudgetUnit,
  FrameworkJsonObject,
  FrameworkSessionKernelState,
} from "./state.ts";

export const FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS = Object.freeze({
  promptItems: "prompt-items",
  promptBytes: "prompt-bytes",
  evidenceItems: "evidence-items",
  evidenceBytes: "evidence-bytes",
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

type BudgetAccumulator<TItem> = {
  items: TItem[];
  usedBytes: number;
  byteTruncated: boolean;
};

function cloneJsonObject<T extends FrameworkJsonObject | undefined>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function normalizeCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.floor(value);
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
  const budgeted = collectBudgetedItems(items, itemLimit, byteLimit, options);
  const itemTruncated = budgeted.items.length < items.length;
  const metadata = createBudgetMetadata({
    requestedItems: items.length,
    returnedItems: budgeted.items.length,
    itemTruncated,
    byteTruncated: budgeted.byteTruncated,
    context: options.metadata,
  });

  updateCollectionBudgetLedgers(state, {
    options,
    itemLimit,
    byteLimit,
    usedItems: budgeted.items.length,
    usedBytes: budgeted.usedBytes,
    metadata,
  });

  return createFrameworkBudgetResult(budgeted, itemLimit, byteLimit, itemTruncated);
}

function collectBudgetedItems<TItem>(
  items: readonly TItem[],
  itemLimit: number,
  byteLimit: number,
  options: ApplyFrameworkBudgetOptions<TItem>,
): BudgetAccumulator<TItem> {
  const accumulator: BudgetAccumulator<TItem> = {
    items: [],
    usedBytes: 0,
    byteTruncated: false,
  };

  for (const item of items) {
    if (accumulator.items.length >= itemLimit) break;
    if (!appendBudgetedItem(accumulator, item, byteLimit, options)) break;
  }

  return accumulator;
}

function appendBudgetedItem<TItem>(
  accumulator: BudgetAccumulator<TItem>,
  item: TItem,
  byteLimit: number,
  options: ApplyFrameworkBudgetOptions<TItem>,
): boolean {
  const size = normalizeCount(options.getSize(item));
  if (accumulator.usedBytes + size <= byteLimit) {
    accumulator.items.push(item);
    accumulator.usedBytes += size;
    return true;
  }

  const remainingBytes = Math.max(0, byteLimit - accumulator.usedBytes);
  appendTruncatedBudgetItem(accumulator, item, remainingBytes, options);
  accumulator.byteTruncated = true;
  return false;
}

function appendTruncatedBudgetItem<TItem>(
  accumulator: BudgetAccumulator<TItem>,
  item: TItem,
  remainingBytes: number,
  options: ApplyFrameworkBudgetOptions<TItem>,
): void {
  if (!options.truncateItem || remainingBytes <= 0) return;

  const truncatedItem = options.truncateItem(item, remainingBytes);
  if (truncatedItem === null) return;

  const truncatedSize = normalizeCount(options.getSize(truncatedItem));
  if (truncatedSize > 0 && truncatedSize <= remainingBytes) {
    accumulator.items.push(truncatedItem);
    accumulator.usedBytes += truncatedSize;
  }
}

function updateCollectionBudgetLedgers<TItem>(
  state: FrameworkSessionKernelState,
  params: {
    options: ApplyFrameworkBudgetOptions<TItem>;
    itemLimit: number;
    byteLimit: number;
    usedItems: number;
    usedBytes: number;
    metadata: FrameworkJsonObject;
  },
): void {
  updateBudgetLedger(state, {
    ledgerKey: params.options.itemLedgerKey,
    used: params.usedItems,
    limit: params.itemLimit,
    unit: "count",
    now: params.options.now,
    metadata: params.metadata,
  });
  updateBudgetLedger(state, {
    ledgerKey: params.options.byteLedgerKey,
    used: params.usedBytes,
    limit: params.byteLimit,
    unit: "bytes",
    now: params.options.now,
    metadata: params.metadata,
  });
}

function createFrameworkBudgetResult<TItem>(
  budgeted: BudgetAccumulator<TItem>,
  itemLimit: number,
  byteLimit: number,
  itemTruncated: boolean,
): FrameworkBudgetResult<TItem> {
  return {
    items: budgeted.items,
    bounds: {
      items: {
        returned: budgeted.items.length,
        limit: itemLimit,
        truncated: itemTruncated,
      },
      bytes: {
        returned: budgeted.usedBytes,
        limit: byteLimit,
        truncated: budgeted.byteTruncated,
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
