import { Effect } from "effect";
import { applyBoundedLimit, DEFAULT_PROVENANCE_ITEM_LIMIT } from "../args.ts";
import {
  loadLocalPathEvidence,
  toProvenanceEvidenceSource,
  type LocalEvidenceMatch,
} from "../evidence/index.ts";
import type { EvidenceItemSummary, LinkedEvidence } from "./schemas.ts";
import { applyByteBudget, parseTimestamp, toNormalizedPath } from "./shared.ts";
import { DEFAULT_EFFECT_CONCURRENCY } from "../../../../shared/effect-runtime.ts";

function compareEvidenceItems(left: LocalEvidenceMatch, right: LocalEvidenceMatch): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  const leftTimestamp = "timestamp" in left ? parseTimestamp(left.timestamp) : null;
  const rightTimestamp = "timestamp" in right ? parseTimestamp(right.timestamp) : null;
  if (leftTimestamp !== rightTimestamp) {
    return (rightTimestamp ?? -1) - (leftTimestamp ?? -1);
  }

  return left.id.localeCompare(right.id);
}

function evidenceByteSize(item: LocalEvidenceMatch): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8");
}

function summarizeEvidenceItem(item: LocalEvidenceMatch): EvidenceItemSummary {
  const source = toProvenanceEvidenceSource(item);

  return {
    kind: item.kind,
    id: source.id,
    path: source.path ?? source.id,
    label: source.label ?? source.id,
    detail: source.detail,
    timestamp: "timestamp" in item ? item.timestamp : undefined,
    score: item.score,
  };
}

export async function buildLinkedEvidence(options: {
  rootDir: string;
  paths: string[];
  limit: number | undefined;
  maxItems: number | undefined;
  maxBytes: number | undefined;
}): Promise<LinkedEvidence> {
  const uniquePaths = [
    ...new Set(options.paths.map((value) => toNormalizedPath(value)).filter(Boolean)),
  ];
  const inspectedPaths = uniquePaths.slice(
    0,
    applyBoundedLimit(uniquePaths, options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT).bounds.limit,
  );

  const results = await Effect.runPromise(
    Effect.forEach(
      inspectedPaths,
      (targetPath) =>
        Effect.promise(() =>
          loadLocalPathEvidence({
            rootDir: options.rootDir,
            path: targetPath,
            perSourceLimit: options.limit,
            maxItems: options.maxItems,
            maxBytes: options.maxBytes,
          }),
        ),
      { concurrency: DEFAULT_EFFECT_CONCURRENCY },
    ),
  );

  const deduped = new Map<string, LocalEvidenceMatch>();
  for (const result of results) {
    for (const item of result.ranked.items) {
      const key = `${item.kind}:${item.id}`;
      const existing = deduped.get(key);
      if (!existing || compareEvidenceItems(item, existing) < 0) {
        deduped.set(key, item);
      }
    }
  }

  const sortedItems = [...deduped.values()].sort(compareEvidenceItems);
  const itemBounded = applyBoundedLimit(
    sortedItems,
    options.maxItems,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  const byteBounded = applyByteBudget(itemBounded.items, options.maxBytes, evidenceByteSize);
  const hints: string[] = [];

  if (uniquePaths.length > inspectedPaths.length) {
    hints.push(
      `Linked evidence inspected ${inspectedPaths.length}/${uniquePaths.length} path(s) to stay bounded.`,
    );
  }

  if (itemBounded.bounds.truncated) {
    hints.push(
      `Linked evidence truncated to ${itemBounded.bounds.returned}/${sortedItems.length} ranked item(s); rerun with a larger max_items to inspect more.`,
    );
  }

  if (byteBounded.bounds.truncated) {
    hints.push(
      `Linked evidence summaries hit the ${byteBounded.bounds.limit}-byte budget for this response and were trimmed to stay bounded.`,
    );
  }

  return {
    inspectedPaths,
    items: byteBounded.items.map((item) => summarizeEvidenceItem(item)),
    bounds: {
      requested: options.maxItems,
      limit: itemBounded.bounds.limit,
      returned: byteBounded.items.length,
      truncated: itemBounded.bounds.truncated || byteBounded.bounds.truncated,
    },
    bytes: byteBounded.bounds,
    hints,
  };
}
