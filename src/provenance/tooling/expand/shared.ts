import { DEFAULT_PROVENANCE_BYTE_LIMIT, resolveBoundedNumber } from "../args.ts";
import {
  createProvenanceFailure,
  type ProvenanceAmbiguity,
  type ProvenanceBounds,
  type ProvenanceConfidence,
  type ProvenanceWarning,
} from "../contracts.ts";
import type { PatchText } from "./schemas.ts";

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const CONFIDENCE_PRIORITY: Record<ProvenanceConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const AMBIGUITY_PRIORITY: Record<ProvenanceAmbiguity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

/** Git's empty tree SHA used to diff root commits against no parent tree. */
export const EMPTY_TREE_HASH = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function toNormalizedPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function parseTimestamp(value: string | undefined): number | null {
  if (!value || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
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

export function getLowestConfidence(
  confidences: readonly ProvenanceConfidence[],
): ProvenanceConfidence {
  let lowest: ProvenanceConfidence = "high";

  for (const confidence of confidences) {
    if (CONFIDENCE_PRIORITY[confidence] < CONFIDENCE_PRIORITY[lowest]) {
      lowest = confidence;
    }
  }

  return lowest;
}

export function getHighestAmbiguity(levels: readonly ProvenanceAmbiguity[]): ProvenanceAmbiguity {
  let highest: ProvenanceAmbiguity = "none";

  for (const level of levels) {
    if (AMBIGUITY_PRIORITY[level] > AMBIGUITY_PRIORITY[highest]) {
      highest = level;
    }
  }

  return highest;
}

export function dedupeWarnings(warnings: readonly ProvenanceWarning[]): ProvenanceWarning[] {
  const seen = new Set<string>();
  const output: ProvenanceWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(warning);
  }

  return output;
}

export function createUnsupportedModeFailure(toolName: `prov_${string}`, mode: string): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: toolName,
      mode: mode as "remote" | "hybrid",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Unsupported provenance mode '${mode}' for ${toolName}.`,
      error: {
        code: "MODE_NOT_SUPPORTED",
        message: `${toolName} currently supports only local mode.`,
      },
    }),
    null,
    2,
  );
}
