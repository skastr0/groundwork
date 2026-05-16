import path from "node:path";
import { readFileString, runProcessText } from "../../../../shared/effect-runtime.ts";
import { computePostImageRanges } from "../diff.ts";
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  DEFAULT_PROVENANCE_BYTE_LIMIT,
  applyBoundedLimit,
  provenanceBaseArg,
  provenanceEndLineArg,
  provenanceLayerArg,
  provenanceLimitArg,
  provenanceMaxBytesArg,
  provenanceModeArg,
  provenancePathArg,
  provenanceRadiusArg,
  provenanceStartLineArg,
  provenanceWindowEndArg,
  provenanceWindowStartArg,
  resolveBoundedNumber,
  type ProvenanceContentLayer,
} from "../args.ts";
import {
  createProvenanceFailure,
  createProvenanceResultSchema,
  createProvenanceSuccess,
  ProvenanceBoundsSchema,
  ProvenanceConfidenceSchema,
  type ProvenanceAmbiguity,
  type ProvenanceBounds,
  type ProvenanceConfidence,
  type ProvenanceEvidenceSource,
  type ProvenanceWarning,
} from "../contracts.ts";
import { ProvSpanHistoryDataSchema, resolveLocalSpanLineage } from "../lineage/index.ts";
import {
  LOCAL_FILE_COMPARISON_STATUS_VALUES,
  normalizeCreateStateToolsOptions,
  normalizeRequestedPath,
  ProvFileStateDataSchema,
  ProvRepoStateDataSchema,
  resolveLocalFileState,
  resolveLocalRepoState,
  toProvFileStateData,
  toProvRepoStateData,
  type CreateStateToolsOptions,
  type LocalFileLayerState,
  type LocalFileState,
  type LocalRepoAmbiguityState,
} from "../state/index.ts";
import { logger } from "../utils/logger.ts";

const GW_READ_TOOL = "gw_read" as const;
const GW_BLOCK_READ_TOOL = "gw_block_read" as const;
type QueryToolName = typeof GW_READ_TOOL | typeof GW_BLOCK_READ_TOOL;

const BLOCK_WINDOW_SOURCE_VALUES = ["focus", "radius", "explicit"] as const;
const DIFF_CONTEXT_RELATION_VALUES = ["overlap", "before", "after"] as const;
const LOCAL_DIFF_CONTEXT_KEY_VALUES = ["head_to_index", "index_to_worktree"] as const;
const LOCAL_DIFF_PERSPECTIVE_VALUES = ["from", "to"] as const;

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

const ProvReadContentSchema = z.object({
  layer: z.enum(["base", "head", "index", "worktree"]),
  ref: z.string().nullable(),
  path: z.string().min(1),
  exists: z.boolean(),
  text: z.string(),
  bounds: ProvenanceBoundsSchema,
  byteCount: z.number().int().nonnegative(),
  hints: z.array(z.string().min(1)),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

export const ProvReadDataSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  repo: ProvRepoStateDataSchema,
  file: ProvFileStateDataSchema,
  content: ProvReadContentSchema,
});

export const ProvReadResultSchema = createProvenanceResultSchema(ProvReadDataSchema);

const RequestedBlockSpanSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const ResolvedBlockWindowSchema = RequestedBlockSpanSchema.extend({
  source: z.enum(BLOCK_WINDOW_SOURCE_VALUES),
  clamped: z.boolean(),
});

const BlockLineSchema = z.object({
  number: z.number().int().positive(),
  text: z.string(),
  inFocus: z.boolean(),
});

const ProvBlockContentSchema = z.object({
  layer: z.enum(["base", "head", "index", "worktree"]),
  ref: z.string().nullable(),
  path: z.string().min(1),
  exists: z.boolean(),
  focus: RequestedBlockSpanSchema,
  window: ResolvedBlockWindowSchema,
  totalLines: z.number().int().nonnegative(),
  lines: z.array(BlockLineSchema),
  text: z.string(),
  bounds: ProvenanceBoundsSchema,
  byteCount: z.number().int().nonnegative(),
  hints: z.array(z.string().min(1)),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

const DiffRangeSummarySchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  relation: z.enum(DIFF_CONTEXT_RELATION_VALUES),
  distance: z.number().int().nonnegative(),
});

const DiffComparisonContextSchema = z.object({
  key: z.enum(LOCAL_DIFF_CONTEXT_KEY_VALUES),
  perspective: z.enum(LOCAL_DIFF_PERSPECTIVE_VALUES),
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
  status: z.enum(LOCAL_FILE_COMPARISON_STATUS_VALUES),
  detected: z.boolean(),
  detectionMethod: z.string().min(1),
  nearbyRanges: z.array(DiffRangeSummarySchema),
  bounds: ProvenanceBoundsSchema,
  hints: z.array(z.string().min(1)),
});

const ProvBlockDiffSchema = z.object({
  focus: RequestedBlockSpanSchema,
  comparisons: z.array(DiffComparisonContextSchema),
  hints: z.array(z.string().min(1)),
});

const ProvBlockLineageSchema = z.object({
  data: ProvSpanHistoryDataSchema,
  bounds: ProvenanceBoundsSchema,
  hints: z.array(z.string().min(1)),
  confidence: ProvenanceConfidenceSchema,
});

export const ProvBlockReadDataSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  repo: ProvRepoStateDataSchema,
  file: ProvFileStateDataSchema,
  content: ProvBlockContentSchema,
  lineage: ProvBlockLineageSchema,
  diff: ProvBlockDiffSchema,
});

export const ProvBlockReadResultSchema = createProvenanceResultSchema(ProvBlockReadDataSchema);

export type ProvReadData = z.infer<typeof ProvReadDataSchema>;
export type ProvReadResult = z.infer<typeof ProvReadResultSchema>;
export type ProvBlockReadData = z.infer<typeof ProvBlockReadDataSchema>;
export type ProvBlockReadResult = z.infer<typeof ProvBlockReadResultSchema>;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getLowestConfidence(confidences: readonly ProvenanceConfidence[]): ProvenanceConfidence {
  let lowest: ProvenanceConfidence = "high";

  for (const confidence of confidences) {
    if (CONFIDENCE_PRIORITY[confidence] < CONFIDENCE_PRIORITY[lowest]) {
      lowest = confidence;
    }
  }

  return lowest;
}

function getHighestAmbiguity(levels: readonly ProvenanceAmbiguity[]): ProvenanceAmbiguity {
  let highest: ProvenanceAmbiguity = "none";

  for (const level of levels) {
    if (AMBIGUITY_PRIORITY[level] > AMBIGUITY_PRIORITY[highest]) {
      highest = level;
    }
  }

  return highest;
}

function getHighestAmbiguityFromWarnings(
  warnings: readonly ProvenanceWarning[],
): ProvenanceAmbiguity {
  return getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low"));
}

function toAmbiguityWarnings(ambiguity: LocalRepoAmbiguityState): ProvenanceWarning[] {
  return ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
}

function createUnsupportedModeFailure(
  toolName: typeof GW_READ_TOOL | typeof GW_BLOCK_READ_TOOL,
  mode: string,
): string {
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

function getSelectedLayerState(
  state: LocalFileState,
  layer: ProvenanceContentLayer,
): LocalFileLayerState {
  switch (layer) {
    case "base":
      return state.base;
    case "head":
      return state.head;
    case "index":
      return state.index;
    case "worktree":
      return state.worktree;
  }
}

function resolveWorktreePath(rootDir: string, filePath: string): string {
  const absolutePath = path.resolve(rootDir, filePath);
  const relativeToRoot = path.relative(rootDir, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Path '${filePath}' resolved outside worktree '${rootDir}'.`);
  }

  return absolutePath;
}

function applyTextBudget(
  value: string,
  requestedBytes: number | undefined,
): {
  text: string;
  bounds: ProvenanceBounds;
  byteCount: number;
} {
  const limit = resolveBoundedNumber(requestedBytes, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const byteCount = Buffer.byteLength(value, "utf8");

  if (byteCount <= limit) {
    return {
      text: value,
      bounds: {
        requested: requestedBytes,
        limit,
        returned: byteCount,
        truncated: false,
      },
      byteCount,
    };
  }

  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > limit) {
    end -= 1;
  }

  const text = value.slice(0, end);
  return {
    text,
    bounds: {
      requested: requestedBytes,
      limit,
      returned: Buffer.byteLength(text, "utf8"),
      truncated: true,
    },
    byteCount,
  };
}

async function readSelectedLayerText(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  layer: ProvenanceContentLayer;
  selectedLayer: LocalFileLayerState;
}): Promise<string> {
  const { layer, selectedLayer } = options;

  if (!selectedLayer.exists) {
    return "";
  }

  switch (layer) {
    case "base":
    case "head":
      return runProcessText({
        shell: options.shell,
        cmd: ["git", "show", `${selectedLayer.ref}:${selectedLayer.path}`],
        trim: false,
      });
    case "index":
      return runProcessText({
        shell: options.shell,
        cmd: ["git", "show", `:${selectedLayer.path}`],
        trim: false,
      });
    case "worktree": {
      const filePath = resolveWorktreePath(options.rootDir, selectedLayer.path);
      return readFileString(filePath);
    }
  }
}

function buildContentHints(options: {
  layer: ProvenanceContentLayer;
  selectedLayer: LocalFileLayerState;
  bounds: ProvenanceBounds;
  byteCount: number;
}): string[] {
  const hints: string[] = [];

  if (!options.selectedLayer.exists) {
    hints.push(`Selected ${options.layer} layer is absent for '${options.selectedLayer.path}'.`);
  }

  if (options.bounds.truncated) {
    hints.push(
      `Content truncated to ${options.bounds.returned}/${options.byteCount} byte(s); rerun with a larger max_bytes to inspect more.`,
    );
  }

  return hints;
}

function normalizeTextLines(value: string): string[] {
  if (!value) {
    return [];
  }

  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (normalized.endsWith("\n")) {
    const trimmed = normalized.slice(0, -1);
    return trimmed ? trimmed.split("\n") : [];
  }

  return normalized.split("\n");
}

function createBlockValidationFailure(options: {
  tool: typeof GW_BLOCK_READ_TOOL;
  requestedPath: string;
  summary: string;
  code: string;
  message: string;
}): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: options.tool,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: options.summary,
      error: {
        code: options.code,
        message: options.message,
      },
    }),
    null,
    2,
  );
}

function resolveRequestedWindow(options: {
  startLine: number;
  endLine: number;
  radius: number | undefined;
  windowStart: number | undefined;
  windowEnd: number | undefined;
  totalLines: number;
}): z.infer<typeof ResolvedBlockWindowSchema> {
  if (options.endLine < options.startLine) {
    throw new Error("end_line must be greater than or equal to start_line.");
  }

  const hasExplicitWindow = options.windowStart !== undefined || options.windowEnd !== undefined;
  if (hasExplicitWindow && options.radius !== undefined) {
    throw new Error("radius cannot be combined with window_start or window_end.");
  }

  if (hasExplicitWindow && (options.windowStart === undefined || options.windowEnd === undefined)) {
    throw new Error("window_start and window_end must be provided together.");
  }

  if (
    options.windowStart !== undefined &&
    options.windowEnd !== undefined &&
    options.windowEnd < options.windowStart
  ) {
    throw new Error("window_end must be greater than or equal to window_start.");
  }

  if (
    options.windowStart !== undefined &&
    options.windowEnd !== undefined &&
    (options.windowStart > options.startLine || options.windowEnd < options.endLine)
  ) {
    throw new Error("Explicit window must fully include the requested start_line and end_line.");
  }

  const source =
    options.windowStart !== undefined ? "explicit" : options.radius ? "radius" : "focus";
  const requestedStart =
    options.windowStart ?? Math.max(1, options.startLine - (options.radius ?? 0));
  const requestedEnd = options.windowEnd ?? options.endLine + (options.radius ?? 0);

  if (options.totalLines <= 0) {
    return {
      startLine: requestedStart,
      endLine: requestedEnd,
      source,
      clamped: false,
    };
  }

  return {
    startLine: Math.min(requestedStart, options.totalLines),
    endLine: Math.min(requestedEnd, options.totalLines),
    source,
    clamped:
      requestedStart !== Math.min(requestedStart, options.totalLines) ||
      requestedEnd !== Math.min(requestedEnd, options.totalLines),
  };
}

function buildBlockLines(options: {
  lines: readonly string[];
  focus: z.infer<typeof RequestedBlockSpanSchema>;
  window: z.infer<typeof ResolvedBlockWindowSchema>;
}): z.infer<typeof BlockLineSchema>[] {
  if (options.lines.length === 0 || options.window.endLine < options.window.startLine) {
    return [];
  }

  return options.lines
    .slice(options.window.startLine - 1, options.window.endLine)
    .map((text, index) => {
      const number = options.window.startLine + index;
      return {
        number,
        text,
        inFocus: number >= options.focus.startLine && number <= options.focus.endLine,
      };
    });
}

function applyBlockLineBudget(
  lines: readonly z.infer<typeof BlockLineSchema>[],
  requestedBytes: number | undefined,
): {
  lines: z.infer<typeof BlockLineSchema>[];
  text: string;
  bounds: ProvenanceBounds;
  byteCount: number;
} {
  const limit = resolveBoundedNumber(requestedBytes, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const byteCount = Buffer.byteLength(lines.map((line) => line.text).join("\n"), "utf8");

  if (lines.length === 0 || byteCount <= limit) {
    const text = lines.map((line) => line.text).join("\n");
    return {
      lines: [...lines],
      text,
      bounds: {
        requested: requestedBytes,
        limit,
        returned: Buffer.byteLength(text, "utf8"),
        truncated: false,
      },
      byteCount,
    };
  }

  const boundedLines: z.infer<typeof BlockLineSchema>[] = [];
  let used = 0;

  for (const line of lines) {
    const prefix = boundedLines.length > 0 ? "\n" : "";
    const size = Buffer.byteLength(`${prefix}${line.text}`, "utf8");
    if (used + size > limit) {
      break;
    }
    boundedLines.push(line);
    used += size;
  }

  const text = boundedLines.map((line) => line.text).join("\n");
  return {
    lines: boundedLines,
    text,
    bounds: {
      requested: requestedBytes,
      limit,
      returned: Buffer.byteLength(text, "utf8"),
      truncated: boundedLines.length !== lines.length,
    },
    byteCount,
  };
}

function buildBlockContentHints(options: {
  layer: ProvenanceContentLayer;
  selectedLayer: LocalFileLayerState;
  window: z.infer<typeof ResolvedBlockWindowSchema>;
  bounds: ProvenanceBounds;
  byteCount: number;
}): string[] {
  const hints = buildContentHints({
    layer: options.layer,
    selectedLayer: options.selectedLayer,
    bounds: options.bounds,
    byteCount: options.byteCount,
  });

  if (options.window.clamped) {
    hints.push(
      `Requested context window was clamped to available lines ${options.window.startLine}-${options.window.endLine}.`,
    );
  }

  return hints;
}

function createBlockContentWarnings(content: ProvBlockReadData["content"]): ProvenanceWarning[] {
  const warnings = createContentWarning({
    layer: content.layer,
    ref: content.ref,
    path: content.path,
    exists: content.exists,
    text: content.text,
    bounds: content.bounds,
    byteCount: content.byteCount,
    hints: content.hints,
    confidence: content.confidence,
    detectionMethod: content.detectionMethod,
  });

  if (content.window.clamped) {
    warnings.push({
      code: "BLOCK_WINDOW_CLAMPED",
      message: `Requested block context was clamped to available lines ${content.window.startLine}-${content.window.endLine}.`,
      ambiguity: "low",
    });
  }

  return warnings;
}

function toLineageHints(options: {
  warnings: readonly ProvenanceWarning[];
  bounds: ProvenanceBounds;
}): string[] {
  const hints = options.warnings.map((warning) => warning.message);

  if (options.bounds.truncated) {
    hints.push(
      `Nearby lineage truncated to ${options.bounds.returned} item(s); rerun with a larger limit to inspect more.`,
    );
  }

  return [...new Set(hints)];
}

function classifyDiffRange(
  range: { start_line: number; end_line: number },
  focus: z.infer<typeof RequestedBlockSpanSchema>,
): z.infer<typeof DiffRangeSummarySchema> {
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

async function buildLocalDiffContext(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  fileState: LocalFileState;
  selectedLayerName: ProvenanceContentLayer;
  focus: z.infer<typeof RequestedBlockSpanSchema>;
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

function createDiffWarnings(diff: ProvBlockReadData["diff"]): ProvenanceWarning[] {
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

function createContentWarning(content: ProvReadData["content"]): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [];

  if (!content.exists) {
    warnings.push({
      code: "CONTENT_LAYER_ABSENT",
      message: `Selected ${content.layer} layer is absent for '${content.path}'.`,
      ambiguity: "low",
    });
  }

  if (content.bounds.truncated) {
    warnings.push({
      code: "CONTENT_TRUNCATED",
      message: `Selected layer content was truncated to ${content.bounds.returned} byte(s).`,
      ambiguity: "low",
    });
  }

  return warnings;
}

function dedupeWarnings(warnings: readonly ProvenanceWarning[]): ProvenanceWarning[] {
  const seen = new Set<string>();
  const deduped: ProvenanceWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(warning);
  }

  return deduped;
}

function buildReadSummary(data: ProvReadData): string {
  const branchLabel = data.repo.branch.name ?? "detached HEAD";
  const baseLabel = data.repo.base.ref ?? "base unresolved";
  const contentLabel = data.content.exists
    ? `${data.content.bounds.returned} byte(s)${data.content.bounds.truncated ? ", truncated" : ""}`
    : "layer absent";

  return `Read ${data.content.layer} layer for ${data.resolvedPath}: ${contentLabel}, repo ${branchLabel} against ${baseLabel}.`;
}

function buildBlockReadSummary(data: ProvBlockReadData): string {
  const branchLabel = data.repo.branch.name ?? "detached HEAD";
  const baseLabel = data.repo.base.ref ?? "base unresolved";
  const contentLabel = data.content.exists
    ? `${data.content.lines.length} line(s) from ${data.content.window.startLine}-${data.content.window.endLine}${data.content.bounds.truncated ? ", truncated" : ""}`
    : "layer absent";
  const nearbyDiffRanges = data.diff.comparisons.reduce(
    (total, comparison) => total + comparison.nearbyRanges.length,
    0,
  );

  return `Read ${data.content.layer} block for ${data.resolvedPath}:${data.content.focus.startLine}-${data.content.focus.endLine}: ${contentLabel}, ${data.lineage.data.lineage.length} nearby lineage item(s), ${nearbyDiffRanges} local diff range(s), repo ${branchLabel} against ${baseLabel}.`;
}

function buildContentSource(content: ProvReadData["content"]): ProvenanceEvidenceSource {
  return {
    kind: "git",
    id: `content:${content.layer}`,
    ref: content.ref ?? content.layer,
    path: content.path,
    label: `${content.layer} content`,
    detail: content.exists
      ? `${content.bounds.returned} byte(s)${content.bounds.truncated ? " (truncated)" : ""}`
      : "absent",
  };
}

function buildBlockContentSource(content: ProvBlockReadData["content"]): ProvenanceEvidenceSource {
  return {
    kind: "git",
    id: `content:${content.layer}`,
    ref: content.ref ?? content.layer,
    path: content.path,
    label: `${content.layer} block`,
    detail: content.exists
      ? `${content.window.startLine}-${content.window.endLine} (${content.lines.length} line(s))${content.bounds.truncated ? " (truncated)" : ""}`
      : "absent",
  };
}

type QueryToolRuntimeOptions = CreateStateToolsOptions;

interface ReadToolInput {
  path: string;
  layer?: ProvenanceContentLayer;
  base?: string;
  mode?: string;
  limit?: number;
  max_bytes?: number;
}

interface BlockReadToolInput extends ReadToolInput {
  start_line: number;
  end_line: number;
  radius?: number;
  window_start?: number;
  window_end?: number;
}

type ReadToolState = {
  repoState: Awaited<ReturnType<typeof resolveLocalRepoState>>;
  fileState: Awaited<ReturnType<typeof resolveLocalFileState>>;
};

type ReadToolRequest = {
  input: ReadToolInput;
  resolvedMode: "local";
  selectedLayerName: ProvenanceContentLayer;
  normalizedPath: string;
};

type BlockReadSuccessInputs = {
  repoState: ReadToolState["repoState"];
  fileState: ReadToolState["fileState"];
  content: ProvBlockReadData["content"];
  lineageResolution: Awaited<ReturnType<typeof resolveLocalSpanLineage>>;
  diff: Awaited<ReturnType<typeof buildLocalDiffContext>>;
};

type BlockContentLayerText = {
  selectedLayer: LocalFileLayerState;
  textLines: string[];
  totalLines: number;
};

type BlockContentWindow = {
  focus: z.infer<typeof RequestedBlockSpanSchema>;
  window: z.infer<typeof ResolvedBlockWindowSchema>;
};

function createReadTool(runtimeOptions: QueryToolRuntimeOptions): ToolDefinition {
  return tool({
    description:
      "Read one file layer with bounded content plus compact repo and file provenance summaries.",
    args: {
      path: provenancePathArg,
      layer: provenanceLayerArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: provenanceLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    execute: (input: ReadToolInput) => executeReadTool(input, runtimeOptions),
  });
}

function createBlockReadTool(runtimeOptions: QueryToolRuntimeOptions): ToolDefinition {
  return tool({
    description:
      "Read one bounded line window from a file layer with nearby lineage and local diff context.",
    args: {
      path: provenancePathArg,
      start_line: provenanceStartLineArg,
      end_line: provenanceEndLineArg,
      radius: provenanceRadiusArg,
      window_start: provenanceWindowStartArg,
      window_end: provenanceWindowEndArg,
      layer: provenanceLayerArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: provenanceLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    execute: (input: BlockReadToolInput) => executeBlockReadTool(input, runtimeOptions),
  });
}

async function executeReadTool(
  input: ReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): Promise<string> {
  const request = normalizeReadToolRequest(input, runtimeOptions);
  if (typeof request === "string") {
    return request;
  }

  logReadToolStart(request);

  try {
    const { repoState, fileState } = await loadQueryToolState(
      runtimeOptions,
      request.normalizedPath,
      input.base,
    );
    const content = await buildReadContent({
      runtimeOptions,
      fileState,
      selectedLayerName: request.selectedLayerName,
      maxBytes: input.max_bytes,
    });

    return serializeReadToolSuccess({
      request,
      repoState,
      fileState,
      content,
    });
  } catch (error) {
    return createReadToolFailure(request, error);
  }
}

function normalizeReadToolRequest(
  input: ReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): string | ReadToolRequest {
  const resolvedMode = input.mode ?? "local";

  if (resolvedMode !== "local") {
    logger.warn("gw_read unsupported mode", {
      tool: GW_READ_TOOL,
      mode: resolvedMode,
    });
    return createUnsupportedModeFailure(GW_READ_TOOL, resolvedMode);
  }

  try {
    return {
      input,
      resolvedMode,
      selectedLayerName: input.layer ?? "worktree",
      normalizedPath: normalizeRequestedPath(input.path, runtimeOptions.rootDir),
    };
  } catch (error) {
    return createPathNormalizationFailure({
      tool: GW_READ_TOOL,
      requestedPath: input.path,
      code: "GW_READ_PATH_INVALID",
      error,
    });
  }
}

function logReadToolStart(request: ReadToolRequest): void {
  logger.info("gw_read start", {
    tool: GW_READ_TOOL,
    mode: request.resolvedMode,
    path: request.normalizedPath,
    layer: request.selectedLayerName,
    base: request.input.base,
    limit: request.input.limit,
    maxBytes: request.input.max_bytes,
  });
}

function serializeReadToolSuccess(params: {
  request: ReadToolRequest;
  repoState: ReadToolState["repoState"];
  fileState: ReadToolState["fileState"];
  content: ProvReadData["content"];
}): string {
  const { request, repoState, fileState, content } = params;
  const data = buildReadData({
    requestedPath: request.input.path.trim(),
    repoState,
    fileState,
    content,
    limit: request.input.limit,
  });
  const response = buildReadResponse({ repoState, fileState, content, data });

  logger.info("gw_read end", {
    tool: GW_READ_TOOL,
    confidence: response.meta.confidence,
    ambiguity: response.meta.ambiguity,
    path: request.normalizedPath,
    resolvedPath: data.resolvedPath,
    layer: content.layer,
    exists: content.exists,
    contentBytes: content.bounds.returned,
  });

  return JSON.stringify(response, null, 2);
}

function createReadToolFailure(request: ReadToolRequest, error: unknown): string {
  const errorMessage = toErrorMessage(error);
  logger.error("gw_read failed", {
    tool: GW_READ_TOOL,
    mode: request.resolvedMode,
    path: request.normalizedPath,
    layer: request.selectedLayerName,
    error: errorMessage,
  });

  return JSON.stringify(
    createProvenanceFailure({
      tool: GW_READ_TOOL,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Failed to read provenance for '${request.normalizedPath}'.`,
      error: {
        code: "GW_READ_UNAVAILABLE",
        message: errorMessage,
      },
    }),
    null,
    2,
  );
}

function createPathNormalizationFailure(options: {
  tool: QueryToolName;
  requestedPath: string;
  code: string;
  error: unknown;
}): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: options.tool,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Failed to normalize path '${options.requestedPath}'.`,
      error: {
        code: options.code,
        message: toErrorMessage(options.error),
      },
    }),
    null,
    2,
  );
}

async function loadQueryToolState(
  runtimeOptions: QueryToolRuntimeOptions,
  normalizedPath: string,
  base: string | undefined,
): Promise<ReadToolState> {
  const [repoState, fileState] = await Promise.all([
    resolveLocalRepoState({
      shell: runtimeOptions.shell,
      explicitBase: base,
    }),
    resolveLocalFileState({
      shell: runtimeOptions.shell,
      requestedPath: normalizedPath,
      explicitBase: base,
    }),
  ]);

  return { repoState, fileState };
}

async function buildReadContent(options: {
  runtimeOptions: QueryToolRuntimeOptions;
  fileState: ReadToolState["fileState"];
  selectedLayerName: ProvenanceContentLayer;
  maxBytes: number | undefined;
}): Promise<ProvReadData["content"]> {
  const selectedLayer = getSelectedLayerState(options.fileState, options.selectedLayerName);
  const rawText = await readSelectedLayerText({
    shell: options.runtimeOptions.shell,
    rootDir: options.runtimeOptions.rootDir ?? process.cwd(),
    layer: options.selectedLayerName,
    selectedLayer,
  });
  const boundedContent = applyTextBudget(rawText, options.maxBytes);

  return {
    layer: options.selectedLayerName,
    ref: selectedLayer.ref,
    path: selectedLayer.path,
    exists: selectedLayer.exists,
    text: boundedContent.text,
    bounds: boundedContent.bounds,
    byteCount: boundedContent.byteCount,
    hints: buildContentHints({
      layer: options.selectedLayerName,
      selectedLayer,
      bounds: boundedContent.bounds,
      byteCount: boundedContent.byteCount,
    }),
    confidence: selectedLayer.confidence,
    detectionMethod: selectedLayer.detectionMethod,
  };
}

function buildReadData(options: {
  requestedPath: string;
  repoState: ReadToolState["repoState"];
  fileState: ReadToolState["fileState"];
  content: ProvReadData["content"];
  limit: number | undefined;
}): ProvReadData {
  return {
    requestedPath: options.requestedPath,
    resolvedPath: options.fileState.resolvedPath,
    repo: toProvRepoStateData(options.repoState, options.limit),
    file: toProvFileStateData(options.fileState),
    content: options.content,
  };
}

function buildReadResponse(options: {
  repoState: ReadToolState["repoState"];
  fileState: ReadToolState["fileState"];
  content: ProvReadData["content"];
  data: ProvReadData;
}): ReturnType<typeof createProvenanceSuccess<ProvReadData>> {
  const warnings = dedupeWarnings([
    ...toAmbiguityWarnings(options.repoState.ambiguity),
    ...toAmbiguityWarnings(options.fileState.ambiguity),
    ...createContentWarning(options.content),
  ]);

  return createProvenanceSuccess({
    tool: GW_READ_TOOL,
    mode: "local",
    confidence: getLowestConfidence([
      options.repoState.confidence,
      options.fileState.confidence,
      options.content.confidence,
    ]),
    ambiguity: getHighestAmbiguity([
      options.repoState.ambiguity.level,
      options.fileState.ambiguity.level,
      getHighestAmbiguityFromWarnings(warnings),
    ]),
    bounds: options.content.bounds,
    summary: buildReadSummary(options.data),
    warnings,
    sources: [buildContentSource(options.content)],
    data: options.data,
  });
}

async function executeBlockReadTool(
  input: BlockReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): Promise<string> {
  const resolvedMode = input.mode ?? "local";
  if (resolvedMode !== "local") {
    return createUnsupportedBlockReadModeFailure(resolvedMode);
  }

  const selectedLayerName = input.layer ?? "worktree";
  const normalizedPath = normalizeBlockReadPath(input, runtimeOptions);
  if (!normalizedPath.success) {
    return normalizedPath.response;
  }

  logBlockReadStart(input, resolvedMode, normalizedPath.path, selectedLayerName);

  try {
    const result = await loadBlockReadSuccessInputs({
      input,
      runtimeOptions,
      normalizedPath: normalizedPath.path,
      selectedLayerName,
    });
    if (typeof result === "string") {
      return result;
    }

    return serializeBlockReadSuccess({
      input,
      normalizedPath: normalizedPath.path,
      ...result,
    });
  } catch (error) {
    return createBlockReadFailure({
      input,
      resolvedMode,
      normalizedPath: normalizedPath.path,
      selectedLayerName,
      error,
    });
  }
}

function createUnsupportedBlockReadModeFailure(mode: string): string {
  logger.warn("gw_block_read unsupported mode", {
    tool: GW_BLOCK_READ_TOOL,
    mode,
  });
  return createUnsupportedModeFailure(GW_BLOCK_READ_TOOL, mode);
}

function normalizeBlockReadPath(
  input: BlockReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): { success: true; path: string } | { success: false; response: string } {
  try {
    return {
      success: true,
      path: normalizeRequestedPath(input.path, runtimeOptions.rootDir),
    };
  } catch (error) {
    return {
      success: false,
      response: createBlockReadPathFailure(input, error),
    };
  }
}

function createBlockReadPathFailure(input: BlockReadToolInput, error: unknown): string {
  return createPathNormalizationFailure({
    tool: GW_BLOCK_READ_TOOL,
    requestedPath: input.path,
    code: "GW_BLOCK_READ_PATH_INVALID",
    error,
  });
}

async function loadBlockReadSuccessInputs(params: {
  input: BlockReadToolInput;
  runtimeOptions: QueryToolRuntimeOptions;
  normalizedPath: string;
  selectedLayerName: ProvenanceContentLayer;
}): Promise<string | BlockReadSuccessInputs> {
  const { input, runtimeOptions, normalizedPath, selectedLayerName } = params;
  const { repoState, fileState } = await loadQueryToolState(
    runtimeOptions,
    normalizedPath,
    input.base,
  );
  const rootDir = runtimeOptions.rootDir ?? process.cwd();
  const contentResult = await resolveBlockReadContent({
    input,
    runtimeOptions,
    rootDir,
    selectedLayerName,
    fileState,
  });
  if (typeof contentResult === "string") {
    return contentResult;
  }

  const { content, selectedLayer } = contentResult;
  const lineageResolution = await resolveLocalSpanLineage({
    shell: runtimeOptions.shell,
    rootDir,
    requestedPath: input.path,
    normalizedPath: selectedLayer.path,
    startLine: content.window.startLine,
    endLine: content.window.endLine,
    limit: input.limit,
  });
  const diff = await buildLocalDiffContext({
    shell: runtimeOptions.shell,
    rootDir,
    fileState,
    selectedLayerName,
    focus: content.focus,
    limit: input.limit,
  });
  return {
    repoState,
    fileState,
    content,
    lineageResolution,
    diff,
  };
}

function createBlockReadFailure(params: {
  input: BlockReadToolInput;
  resolvedMode: string;
  normalizedPath: string;
  selectedLayerName: ProvenanceContentLayer;
  error: unknown;
}): string {
  const errorMessage = toErrorMessage(params.error);
  logger.error("gw_block_read failed", {
    tool: GW_BLOCK_READ_TOOL,
    mode: params.resolvedMode,
    path: params.normalizedPath,
    layer: params.selectedLayerName,
    startLine: params.input.start_line,
    endLine: params.input.end_line,
    error: errorMessage,
  });

  return JSON.stringify(
    createProvenanceFailure({
      tool: GW_BLOCK_READ_TOOL,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Failed to read block provenance for '${params.normalizedPath}:${params.input.start_line}-${params.input.end_line}'.`,
      error: {
        code: "GW_BLOCK_READ_UNAVAILABLE",
        message: errorMessage,
      },
    }),
    null,
    2,
  );
}

function logBlockReadStart(
  input: BlockReadToolInput,
  resolvedMode: string,
  normalizedPath: string,
  selectedLayerName: ProvenanceContentLayer,
): void {
  logger.info("gw_block_read start", {
    tool: GW_BLOCK_READ_TOOL,
    mode: resolvedMode,
    path: normalizedPath,
    layer: selectedLayerName,
    startLine: input.start_line,
    endLine: input.end_line,
    radius: input.radius,
    windowStart: input.window_start,
    windowEnd: input.window_end,
    base: input.base,
    limit: input.limit,
    maxBytes: input.max_bytes,
  });
}

async function resolveBlockReadContent(params: {
  input: BlockReadToolInput;
  runtimeOptions: QueryToolRuntimeOptions;
  rootDir: string;
  selectedLayerName: ProvenanceContentLayer;
  fileState: LocalFileState;
}): Promise<
  | string
  | {
      selectedLayer: LocalFileLayerState;
      content: ProvBlockReadData["content"];
    }
> {
  const { input, runtimeOptions, rootDir, selectedLayerName, fileState } = params;
  const layerText = await loadBlockContentLayerText({
    runtimeOptions,
    rootDir,
    selectedLayerName,
    fileState,
  });

  const rangeFailure = validateBlockContentRange(input, selectedLayerName, layerText);
  if (rangeFailure) {
    return rangeFailure;
  }

  const window = resolveBlockContentWindow(input, layerText.totalLines);
  if (typeof window === "string") {
    return window;
  }

  return {
    selectedLayer: layerText.selectedLayer,
    content: assembleBlockReadContent({
      input,
      selectedLayerName,
      layerText,
      window,
    }),
  };
}

async function loadBlockContentLayerText(params: {
  runtimeOptions: QueryToolRuntimeOptions;
  rootDir: string;
  selectedLayerName: ProvenanceContentLayer;
  fileState: LocalFileState;
}): Promise<BlockContentLayerText> {
  const selectedLayer = getSelectedLayerState(params.fileState, params.selectedLayerName);
  const rawText = await readSelectedLayerText({
    shell: params.runtimeOptions.shell,
    rootDir: params.rootDir,
    layer: params.selectedLayerName,
    selectedLayer,
  });
  const textLines = normalizeTextLines(rawText);

  return {
    selectedLayer,
    textLines,
    totalLines: textLines.length,
  };
}

function validateBlockContentRange(
  input: BlockReadToolInput,
  selectedLayerName: ProvenanceContentLayer,
  layerText: BlockContentLayerText,
): string | undefined {
  if (
    !layerText.selectedLayer.exists ||
    (layerText.totalLines > 0 &&
      input.start_line <= layerText.totalLines &&
      input.end_line <= layerText.totalLines)
  ) {
    return undefined;
  }

  return createBlockValidationFailure({
    tool: GW_BLOCK_READ_TOOL,
    requestedPath: input.path,
    summary: `Requested block '${input.path}:${input.start_line}-${input.end_line}' is outside the selected layer.`,
    code: "BLOCK_RANGE_OUT_OF_BOUNDS",
    message: `Requested block exceeds the selected ${selectedLayerName} layer length of ${layerText.totalLines} line(s).`,
  });
}

function resolveBlockContentWindow(
  input: BlockReadToolInput,
  totalLines: number,
): string | BlockContentWindow {
  try {
    return {
      focus: {
        startLine: input.start_line,
        endLine: input.end_line,
      },
      window: resolveRequestedWindow({
        startLine: input.start_line,
        endLine: input.end_line,
        radius: input.radius,
        windowStart: input.window_start,
        windowEnd: input.window_end,
        totalLines,
      }),
    };
  } catch (error) {
    return createBlockValidationFailure({
      tool: GW_BLOCK_READ_TOOL,
      requestedPath: input.path,
      summary: `Invalid block window for '${input.path}:${input.start_line}-${input.end_line}'.`,
      code: "BLOCK_WINDOW_INVALID",
      message: toErrorMessage(error),
    });
  }
}

function assembleBlockReadContent(params: {
  input: BlockReadToolInput;
  selectedLayerName: ProvenanceContentLayer;
  layerText: BlockContentLayerText;
  window: BlockContentWindow;
}): ProvBlockReadData["content"] {
  const { input, selectedLayerName, layerText, window } = params;
  const boundedBlock = applyBlockLineBudget(
    buildBlockLines({
      lines: layerText.textLines,
      focus: window.focus,
      window: window.window,
    }),
    input.max_bytes,
  );

  return {
    layer: selectedLayerName,
    ref: layerText.selectedLayer.ref,
    path: layerText.selectedLayer.path,
    exists: layerText.selectedLayer.exists,
    focus: window.focus,
    window: window.window,
    totalLines: layerText.totalLines,
    lines: boundedBlock.lines,
    text: boundedBlock.text,
    bounds: boundedBlock.bounds,
    byteCount: boundedBlock.byteCount,
    hints: buildBlockContentHints({
      layer: selectedLayerName,
      selectedLayer: layerText.selectedLayer,
      window: window.window,
      bounds: boundedBlock.bounds,
      byteCount: boundedBlock.byteCount,
    }),
    confidence: layerText.selectedLayer.confidence,
    detectionMethod: layerText.selectedLayer.detectionMethod,
  };
}

function serializeBlockReadSuccess(params: {
  input: BlockReadToolInput;
  normalizedPath: string;
  repoState: Awaited<ReturnType<typeof resolveLocalRepoState>>;
  fileState: LocalFileState;
  content: ProvBlockReadData["content"];
  lineageResolution: Awaited<ReturnType<typeof resolveLocalSpanLineage>>;
  diff: Awaited<ReturnType<typeof buildLocalDiffContext>>;
}): string {
  const { input, normalizedPath, repoState, fileState, content, lineageResolution, diff } = params;
  const data: ProvBlockReadData = {
    requestedPath: input.path.trim(),
    resolvedPath: fileState.resolvedPath,
    repo: toProvRepoStateData(repoState, input.limit),
    file: toProvFileStateData(fileState),
    content,
    lineage: {
      data: lineageResolution.data,
      bounds: lineageResolution.bounds,
      hints: toLineageHints({
        warnings: lineageResolution.warnings,
        bounds: lineageResolution.bounds,
      }),
      confidence: lineageResolution.confidence,
    },
    diff,
  };
  const warnings = dedupeWarnings([
    ...toAmbiguityWarnings(repoState.ambiguity),
    ...toAmbiguityWarnings(fileState.ambiguity),
    ...createBlockContentWarnings(content),
    ...lineageResolution.warnings,
    ...createDiffWarnings(diff),
  ]);
  const response = createProvenanceSuccess({
    tool: GW_BLOCK_READ_TOOL,
    mode: "local",
    confidence: getLowestConfidence([
      repoState.confidence,
      fileState.confidence,
      content.confidence,
      data.lineage.confidence,
    ]),
    ambiguity: getHighestAmbiguity([
      repoState.ambiguity.level,
      fileState.ambiguity.level,
      getHighestAmbiguityFromWarnings(warnings),
    ]),
    bounds: content.bounds,
    summary: buildBlockReadSummary(data),
    warnings,
    sources: [
      buildBlockContentSource(content),
      ...lineageResolution.sources,
    ],
    data,
  });

  logger.info("gw_block_read end", {
    tool: GW_BLOCK_READ_TOOL,
    confidence: response.meta.confidence,
    ambiguity: response.meta.ambiguity,
    path: normalizedPath,
    resolvedPath: data.resolvedPath,
    layer: content.layer,
    focusStartLine: content.focus.startLine,
    focusEndLine: content.focus.endLine,
    returnedLines: content.lines.length,
    lineageItems: data.lineage.data.lineage.length,
    diffComparisons: diff.comparisons.length,
  });

  return JSON.stringify(response, null, 2);
}

export function createQueryTools(options: CreateStateToolsOptions): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [GW_READ_TOOL]: createReadTool(runtimeOptions),
    [GW_BLOCK_READ_TOOL]: createBlockReadTool(runtimeOptions),
  };
}
