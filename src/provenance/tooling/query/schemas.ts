import { z } from "zod";
import {
  createProvenanceResultSchema,
  ProvenanceBoundsSchema,
  ProvenanceConfidenceSchema,
} from "../contracts.ts";
import { ProvSpanHistoryDataSchema } from "../lineage/index.ts";
import {
  LOCAL_FILE_COMPARISON_STATUS_VALUES,
  ProvFileStateDataSchema,
  ProvRepoStateDataSchema,
} from "../state/index.ts";

export const GW_READ_TOOL = "gw_read" as const;
export const GW_BLOCK_READ_TOOL = "gw_block_read" as const;
export type QueryToolName = typeof GW_READ_TOOL | typeof GW_BLOCK_READ_TOOL;

export const BLOCK_WINDOW_SOURCE_VALUES = ["focus", "radius", "explicit"] as const;
export const DIFF_CONTEXT_RELATION_VALUES = ["overlap", "before", "after"] as const;
export const LOCAL_DIFF_CONTEXT_KEY_VALUES = ["head_to_index", "index_to_worktree"] as const;
export const LOCAL_DIFF_PERSPECTIVE_VALUES = ["from", "to"] as const;

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

export const RequestedBlockSpanSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

export const ResolvedBlockWindowSchema = RequestedBlockSpanSchema.extend({
  source: z.enum(BLOCK_WINDOW_SOURCE_VALUES),
  clamped: z.boolean(),
});

export const BlockLineSchema = z.object({
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

export const DiffRangeSummarySchema = z.object({
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
export type RequestedBlockSpan = z.infer<typeof RequestedBlockSpanSchema>;
export type ResolvedBlockWindow = z.infer<typeof ResolvedBlockWindowSchema>;
export type BlockLine = z.infer<typeof BlockLineSchema>;
export type DiffRangeSummary = z.infer<typeof DiffRangeSummarySchema>;
