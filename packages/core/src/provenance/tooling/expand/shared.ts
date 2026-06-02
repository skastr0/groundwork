import { DEFAULT_PROVENANCE_BYTE_LIMIT, resolveBoundedNumber } from "../args.ts";
import { type ProvenanceBounds } from "../contracts.ts";
export {
  createLocalToolFailure,
  createUnsupportedModeFailure,
  dedupeWarnings,
  getHighestAmbiguity,
  getLowestConfidence,
  toErrorMessage,
} from "../shared.ts";
import type { PatchText } from "./schemas.ts";

/** Git's empty tree SHA used to diff root commits against no parent tree. */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function toNormalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function applyByteBudget<TItem>(
  items: readonly TItem[],
  requested: number | undefined,
  getSize: (item: TItem) => number,
): { items: TItem[]; bounds: ProvenanceBounds } {
  const limit = resolveBoundedNumber(requested, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const boundedItems: TItem[] = [];
  let used = 0;
  let truncated = false;

  for (const item of items) {
    const size = getSize(item);
    if (used + size > limit) {
      truncated = true;
      break;
    }
    boundedItems.push(item);
    used += size;
  }

  return {
    items: boundedItems,
    bounds: {
      requested,
      limit,
      returned: used,
      truncated: truncated || boundedItems.length !== items.length,
    },
  };
}

export function applyTextBudget(value: string, requested: number | undefined): PatchText {
  const limit = resolveBoundedNumber(requested, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const normalized = value.endsWith("\n") ? value : `${value}\n`;
  const byteCount = Buffer.byteLength(normalized, "utf8");

  if (byteCount <= limit) {
    return {
      included: true,
      value: normalized,
      bounds: {
        requested,
        limit,
        returned: byteCount,
        truncated: false,
      },
      byteCount,
    };
  }

  const suffix = "\n... [truncated]\n";
  let end = normalized.length;
  while (end > 0 && Buffer.byteLength(`${normalized.slice(0, end)}${suffix}`, "utf8") > limit) {
    end -= 1;
  }

  const truncatedValue = `${normalized.slice(0, end).trimEnd()}${suffix}`;
  return {
    included: true,
    value: truncatedValue,
    bounds: {
      requested,
      limit,
      returned: Buffer.byteLength(truncatedValue, "utf8"),
      truncated: true,
    },
    byteCount,
  };
}

export function createEmptyPatchText(requested: number | undefined): PatchText {
  return {
    included: false,
    bounds: {
      requested,
      limit: resolveBoundedNumber(requested, DEFAULT_PROVENANCE_BYTE_LIMIT),
      returned: 0,
      truncated: false,
    },
    byteCount: 0,
  };
}
