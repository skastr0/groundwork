import {
  cloneLineRanges,
  mergeLineRanges,
} from "../kernel/line-ranges.ts";
import type { GuardrailChangeTarget } from "./config.ts";

export { cloneLineRanges, mergeLineRanges } from "../kernel/line-ranges.ts";

const PATCH_TEXT_KEYS = new Set(["patch", "patchtext", "patch_text"]);

export function isPatchTextKey(key: string | undefined): boolean {
  return PATCH_TEXT_KEYS.has(key?.toLowerCase() ?? "");
}

export function collectPatchPayloads(value: unknown, keyName?: string): string[] {
  if (typeof value === "string") {
    return isPatchTextKey(keyName) ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPatchPayloads(entry, keyName));
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([childKey, childValue]) =>
    collectPatchPayloads(childValue, childKey),
  );
}

export function mergeChangeTarget(
  out: Map<string, GuardrailChangeTarget>,
  incoming: GuardrailChangeTarget,
): void {
  const existing = out.get(incoming.normalizedPath);
  if (!existing) {
    out.set(incoming.normalizedPath, cloneChangeTarget(incoming));
    return;
  }

  out.set(incoming.normalizedPath, {
    normalizedPath: incoming.normalizedPath,
    beforeContent: existing.beforeContent ?? incoming.beforeContent,
    changedLineRanges: mergeLineRanges(existing.changedLineRanges, incoming.changedLineRanges),
    deletedLineRanges: mergeLineRanges(existing.deletedLineRanges, incoming.deletedLineRanges),
  });
}

function cloneChangeTarget(target: GuardrailChangeTarget): GuardrailChangeTarget {
  return {
    normalizedPath: target.normalizedPath,
    beforeContent: target.beforeContent,
    changedLineRanges: cloneLineRanges(target.changedLineRanges),
    deletedLineRanges: cloneLineRanges(target.deletedLineRanges),
  };
}
