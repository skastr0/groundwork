import { computePostImageRanges } from "../diff.ts";
import {
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
  type ProvenanceContentLayer,
} from "../args.ts";
import type {
  CreateStateToolsOptions,
  LocalFileState,
} from "../state/internal.ts";
import type { ProvenanceWarning } from "../contracts.ts";
import { getSelectedLayerState, readSelectedLayerText } from "./content.ts";
import type {
  DiffRangeSummary,
  ProvBlockReadData,
  RequestedBlockSpan,
} from "./schemas.ts";

export async function buildLocalDiffContext(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  fileState: LocalFileState;
  selectedLayerName: ProvenanceContentLayer;
  focus: RequestedBlockSpan;
  limit: number | undefined;
}): Promise<ProvBlockReadData["diff"]> {
  const comparisonsToInspect = [
    {
      key: "head_to_index" as const,
      comparison: options.fileState.comparisons.headToIndex,
      fromLayer: "head" as const,
      toLayer: "index" as const,
    },
    {
      key: "index_to_worktree" as const,
      comparison: options.fileState.comparisons.indexToWorktree,
      fromLayer: "index" as const,
      toLayer: "worktree" as const,
    },
  ].filter(
    (entry) =>
      options.selectedLayerName === entry.fromLayer || options.selectedLayerName === entry.toLayer,
  );

  if (comparisonsToInspect.length === 0) {
    return {
      focus: options.focus,
      comparisons: [],
      hints: ["Local diff context is only available for head, index, and worktree layers."],
    };
  }

  const resolvedComparisons = await Promise.all(
    comparisonsToInspect.map(async (entry) => {
      const perspective = options.selectedLayerName === entry.fromLayer ? "from" : "to";
      const fromState = getSelectedLayerState(options.fileState, entry.fromLayer);
      const toState = getSelectedLayerState(options.fileState, entry.toLayer);
      const fromText = await readSelectedLayerText({
        shell: options.shell,
        rootDir: options.rootDir,
        layer: entry.fromLayer,
        selectedLayer: fromState,
      });
      const toText = await readSelectedLayerText({
        shell: options.shell,
        rootDir: options.rootDir,
        layer: entry.toLayer,
        selectedLayer: toState,
      });
      const rawRanges =
        perspective === "to"
          ? computePostImageRanges(fromText, toText)
          : computePostImageRanges(toText, fromText);
      const nearbyRanges = rawRanges
        .map((range) => classifyDiffRange(range, options.focus))
        .sort((left, right) => {
          if (left.distance !== right.distance) {
            return left.distance - right.distance;
          }

          return left.startLine - right.startLine;
        });
      const boundedNearbyRanges = applyBoundedLimit(
        nearbyRanges,
        options.limit,
        DEFAULT_PROVENANCE_ITEM_LIMIT,
      );
      const hints: string[] = [];

      if (!entry.comparison.detected) {
        hints.push("No local diff entries were detected for this comparison.");
      }

      if (boundedNearbyRanges.bounds.truncated) {
        hints.push(
          `Nearby diff ranges truncated to ${boundedNearbyRanges.bounds.returned} item(s); rerun with a larger limit to inspect more.`,
        );
      }

      return {
        key: entry.key,
        perspective,
        fromRef: entry.comparison.fromRef,
        toRef: entry.comparison.toRef,
        fromPath: entry.comparison.fromPath,
        toPath: entry.comparison.toPath,
        status: entry.comparison.status,
        detected: entry.comparison.detected,
        detectionMethod: entry.comparison.detectionMethod,
        nearbyRanges: boundedNearbyRanges.items,
        bounds: boundedNearbyRanges.bounds,
        hints,
      } satisfies ProvBlockReadData["diff"]["comparisons"][number];
    }),
  );

  return {
    focus: options.focus,
    comparisons: resolvedComparisons,
    hints: resolvedComparisons.flatMap((comparison) => comparison.hints),
  };
}

export function createDiffWarnings(diff: ProvBlockReadData["diff"]): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [];

  for (const comparison of diff.comparisons) {
    if (comparison.bounds.truncated) {
      warnings.push({
        code: "LOCAL_DIFF_TRUNCATED",
        message: `Nearby local diff context was truncated for ${comparison.fromRef}->${comparison.toRef}.`,
        ambiguity: "low",
      });
    }
  }

  return warnings;
}

function classifyDiffRange(
  range: { start_line: number; end_line: number },
  focus: RequestedBlockSpan,
): DiffRangeSummary {
  if (range.end_line < focus.startLine) {
    return {
      startLine: range.start_line,
      endLine: range.end_line,
      relation: "before",
      distance: focus.startLine - range.end_line,
    };
  }

  if (range.start_line > focus.endLine) {
    return {
      startLine: range.start_line,
      endLine: range.end_line,
      relation: "after",
      distance: range.start_line - focus.endLine,
    };
  }

  return {
    startLine: range.start_line,
    endLine: range.end_line,
    relation: "overlap",
    distance: 0,
  };
}
