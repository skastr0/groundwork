import { applyBoundedLimit, DEFAULT_PROVENANCE_ITEM_LIMIT } from "../args.ts";
import type { ParsedDiffSection } from "./diff-parser.ts";
import type {
  ChangeContextKey,
  DiffChangeSummary,
  NearbyFileSummary,
  PatchSummary,
} from "./schemas.ts";
import { createEmptyPatchText, applyTextBudget } from "./shared.ts";
import { getCanonicalPath, getOldPath } from "./diff-parser.ts";

export function buildPatchSummary(options: {
  section: ParsedDiffSection;
  limit: number | undefined;
  maxBytes: number | undefined;
  includePatch: boolean;
}): PatchSummary {
  const hunkBounded = applyBoundedLimit(
    options.section.hunks,
    options.limit,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  const hints: string[] = [];

  if (hunkBounded.bounds.truncated) {
    hints.push(
      `Patch hunk summaries truncated to ${hunkBounded.bounds.returned}/${options.section.hunks.length}.`,
    );
  }

  const text = options.includePatch
    ? applyTextBudget(options.section.patchText, options.maxBytes)
    : createEmptyPatchText(options.maxBytes);

  if (options.includePatch && text.bounds.truncated) {
    hints.push(`Raw patch text hit the ${text.bounds.limit}-byte budget and was truncated.`);
  }

  if (!options.includePatch && options.section.patchText.length > 0) {
    hints.push("Rerun with include_patch=true to include bounded raw patch text.");
  }

  return {
    additions: options.section.additions,
    deletions: options.section.deletions,
    hunkCount: options.section.hunks.length,
    hunks: hunkBounded.items,
    hunkBounds: hunkBounded.bounds,
    text,
    hints,
  };
}

export function toDiffChangeSummary(options: {
  key: ChangeContextKey;
  fromRef: string | null;
  toRef: string | null;
  section: ParsedDiffSection;
  limit: number | undefined;
  maxBytes: number | undefined;
  includePatch: boolean;
}): DiffChangeSummary {
  return {
    key: options.key,
    fromRef: options.fromRef,
    toRef: options.toRef,
    path: getCanonicalPath(options.section),
    oldPath: getOldPath(options.section),
    status: options.section.status,
    patch: buildPatchSummary({
      section: options.section,
      limit: options.limit,
      maxBytes: options.maxBytes,
      includePatch: options.includePatch,
    }),
  };
}

export function toNearbyFileSummary(options: {
  key: ChangeContextKey;
  fromRef: string | null;
  toRef: string | null;
  section: ParsedDiffSection;
}): NearbyFileSummary {
  return {
    key: options.key,
    fromRef: options.fromRef,
    toRef: options.toRef,
    path: getCanonicalPath(options.section),
    oldPath: getOldPath(options.section),
    status: options.section.status,
    additions: options.section.additions,
    deletions: options.section.deletions,
    hunkCount: options.section.hunks.length,
  };
}
