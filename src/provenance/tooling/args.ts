import { z } from "zod";
import { ProvenanceModeSchema, type ProvenanceBounds } from "./contracts.ts";

export const PROVENANCE_CONTENT_LAYER_VALUES = ["base", "head", "index", "worktree"] as const;
export const ProvenanceContentLayerSchema = z.enum(PROVENANCE_CONTENT_LAYER_VALUES);
export type ProvenanceContentLayer = z.infer<typeof ProvenanceContentLayerSchema>;

export type BoundedNumberRuntimeOptions = {
  defaultValue: number;
  maxValue: number;
  minValue?: number;
};

export type BoundedNumberArgOptions = BoundedNumberRuntimeOptions & {
  description: string;
};

export type BoundedPayload<TItem> = {
  items: TItem[];
  bounds: ProvenanceBounds;
};

export const DEFAULT_PROVENANCE_ITEM_LIMIT = {
  defaultValue: 20,
  maxValue: 200,
} satisfies BoundedNumberRuntimeOptions;

export const DEFAULT_PROVENANCE_BYTE_LIMIT = {
  defaultValue: 12000,
  maxValue: 100000,
} satisfies BoundedNumberRuntimeOptions;

export const DEFAULT_PROVENANCE_DEPTH_LIMIT = {
  defaultValue: 2,
  maxValue: 8,
} satisfies BoundedNumberRuntimeOptions;

export const DEFAULT_PROVENANCE_RADIUS = {
  defaultValue: 3,
  maxValue: 200,
  minValue: 0,
} satisfies BoundedNumberRuntimeOptions;

export function createBoundedNumberArg(options: BoundedNumberArgOptions) {
  const minimum = options.minValue ?? 1;

  return z
    .number()
    .int()
    .min(minimum)
    .max(options.maxValue)
    .optional()
    .describe(
      `${options.description} (default: ${options.defaultValue}, max: ${options.maxValue})`,
    );
}

export function resolveBoundedNumber(
  requested: number | undefined,
  options: BoundedNumberRuntimeOptions,
): number {
  const minimum = options.minValue ?? 1;

  if (requested === undefined) {
    return options.defaultValue;
  }

  return Math.min(Math.max(Math.trunc(requested), minimum), options.maxValue);
}

export function applyBoundedLimit<TItem>(
  items: readonly TItem[],
  requested: number | undefined,
  options: BoundedNumberRuntimeOptions,
): BoundedPayload<TItem> {
  const limit = resolveBoundedNumber(requested, options);
  const sliced = items.slice(0, limit);

  return {
    items: [...sliced],
    bounds: {
      requested,
      limit,
      returned: sliced.length,
      truncated: items.length > limit,
    },
  };
}

export const provenancePathArg = z
  .string()
  .describe("Workspace-relative or absolute path anchor to inspect");

export const provenanceStartLineArg = z
  .number()
  .int()
  .min(1)
  .describe("1-based inclusive start line for the requested span");

export const provenanceEndLineArg = z
  .number()
  .int()
  .min(1)
  .describe("1-based inclusive end line for the requested span");

export const provenanceRadiusArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_RADIUS,
  description: "Extra context lines to include before and after the requested block",
});

export const provenanceWindowStartArg = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe("1-based inclusive start line for an explicit returned window");

export const provenanceWindowEndArg = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe("1-based inclusive end line for an explicit returned window");

export const provenanceRefArg = z
  .string()
  .optional()
  .describe("Git ref or logical state to inspect (for example: base, HEAD, index, worktree)");

export const provenanceBaseArg = z
  .string()
  .optional()
  .describe("Base branch or ref for provenance comparisons (auto-detected when omitted)");

const PROVENANCE_COMMIT_REF_PATTERN =
  /^(?:[0-9a-fA-F]{7,40}|[A-Za-z0-9][A-Za-z0-9._/-]*(?:[~^][0-9]+)*)$/;

export const provenanceCommitArg = z
  .string()
  .regex(PROVENANCE_COMMIT_REF_PATTERN)
  .describe("Commit hash or simple git rev to inspect (for example: abc1234, HEAD~1, origin/main)");

export const provenanceModeArg = ProvenanceModeSchema.optional().describe(
  "Evidence mode: local, remote, or hybrid",
);

export const provenanceLayerArg = ProvenanceContentLayerSchema.optional().describe(
  "Content layer to read: base, head, index, or worktree (default: worktree)",
);

export const provenanceScopeArg = z
  .enum(["branch", "working_tree", "staged"])
  .optional()
  .describe("Repository scope anchor for provenance collection");

export const provenanceLimitArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_ITEM_LIMIT,
  description: "Max evidence rows to return",
});

export const provenanceMaxBytesArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_BYTE_LIMIT,
  description: "Max text bytes to include in the payload",
});

export const provenanceMaxDepthArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_DEPTH_LIMIT,
  description: "Max expansion depth",
});

export const provenanceCommonArgs = {
  path: provenancePathArg,
  ref: provenanceRefArg,
  base: provenanceBaseArg,
  mode: provenanceModeArg,
  scope: provenanceScopeArg,
  limit: provenanceLimitArg,
  max_bytes: provenanceMaxBytesArg,
  max_depth: provenanceMaxDepthArg,
};
