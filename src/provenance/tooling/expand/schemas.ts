import { z } from "zod";
import { DEFAULT_PROVENANCE_ITEM_LIMIT, createBoundedNumberArg } from "../args.ts";
import {
  createProvenanceResultSchema,
  ProvenanceBoundsSchema,
  ProvenanceConfidenceSchema,
} from "../contracts.ts";
import {
  LOCAL_REPO_FILE_STATUS_VALUES,
  ProvFileStateDataSchema,
  ProvRepoStateDataSchema,
} from "../state/index.ts";

export const GW_DIFF_EXPAND_TOOL = "gw_diff_expand" as const;
export const GW_COMMIT_MATERIALIZE_TOOL = "gw_commit_materialize" as const;
export const GW_COMMIT_EXPAND_TOOL = "gw_commit_expand" as const;
export const GW_TREE_EXPAND_TOOL = "gw_tree_expand" as const;
export const GW_WORKTREE_OVERVIEW_TOOL = "gw_worktree_overview" as const;
export const GW_PR_MATERIALIZE_TOOL = "gw_pr_materialize" as const;
export const GW_PR_EXPAND_TOOL = "gw_pr_expand" as const;

export const ANCHOR_KIND_VALUES = ["file", "diff"] as const;
export const CHANGE_CONTEXT_KEY_VALUES = [
  "base_to_head",
  "head_to_index",
  "index_to_worktree",
  "artifact",
  "commit",
] as const;

export type ChangeContextKey = (typeof CHANGE_CONTEXT_KEY_VALUES)[number];

export const includePatchArg = z
  .boolean()
  .optional()
  .describe("Include bounded raw patch text in the response (disabled by default)");

export const diffSummaryLimitArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_ITEM_LIMIT,
  description: "Max direct change summaries and nearby file summaries to return",
});

export const BoundedTextSchema = z.object({
  text: z.string(),
  bounds: ProvenanceBoundsSchema,
  byteCount: z.number().int().nonnegative(),
});

export const PatchHunkSchema = z.object({
  header: z.string().min(1),
  oldStart: z.number().int().nonnegative(),
  oldCount: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const PatchTextSchema = z.object({
  included: z.boolean(),
  value: z.string().optional(),
  bounds: ProvenanceBoundsSchema,
  byteCount: z.number().int().nonnegative(),
});

export const PatchSummarySchema = z.object({
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hunkCount: z.number().int().nonnegative(),
  hunks: z.array(PatchHunkSchema),
  hunkBounds: ProvenanceBoundsSchema,
  text: PatchTextSchema,
  hints: z.array(z.string().min(1)),
});

export const DiffChangeSummarySchema = z.object({
  key: z.enum(CHANGE_CONTEXT_KEY_VALUES),
  fromRef: z.string().nullable(),
  toRef: z.string().nullable(),
  path: z.string().min(1),
  oldPath: z.string().min(1).optional(),
  status: z.enum(LOCAL_REPO_FILE_STATUS_VALUES),
  patch: PatchSummarySchema,
});

export const NearbyFileSummarySchema = z.object({
  key: z.enum(CHANGE_CONTEXT_KEY_VALUES),
  fromRef: z.string().nullable(),
  toRef: z.string().nullable(),
  path: z.string().min(1),
  oldPath: z.string().min(1).optional(),
  status: z.enum(LOCAL_REPO_FILE_STATUS_VALUES),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  hunkCount: z.number().int().nonnegative(),
});

export const TREE_SCOPE_TYPE_VALUES = ["branch", "working_tree", "staged"] as const;
export const TREE_AREA_KIND_VALUES = ["root", "directory", "package"] as const;

export const TreeStatusBreakdownSchema = z.object({
  added: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  renamed: z.number().int().nonnegative(),
  copied: z.number().int().nonnegative(),
  unknown: z.number().int().nonnegative(),
});

export const TreeCheckoutSummarySchema = z.object({
  staged: z.number().int().nonnegative(),
  unstaged: z.number().int().nonnegative(),
  untracked: z.number().int().nonnegative(),
});

export const TreeFileSummarySchema = NearbyFileSummarySchema.extend({
  matchedPath: z.string().min(1),
});

export const TreeAreaSummarySchema = z.object({
  path: z.string().min(1),
  kind: z.enum(TREE_AREA_KIND_VALUES),
  depth: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  statuses: TreeStatusBreakdownSchema,
  checkout: TreeCheckoutSummarySchema,
  samplePaths: z.array(z.string().min(1)),
});

export const TreeAnchorSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  kind: z.enum(TREE_AREA_KIND_VALUES),
});

export const TreeScopeSchema = z.object({
  type: z.enum(TREE_SCOPE_TYPE_VALUES),
  branchName: z.string().nullable(),
  baseRef: z.string().nullable(),
  baseDetectionMethod: z.string().min(1),
  changeDetectionMethod: z.string().min(1),
});

export const TreeCommitSummarySchema = z.object({
  commit: z.string().min(1),
  shortCommit: z.string().min(1),
  authorName: z.string().min(1),
  authoredAt: z.string().min(1),
  summary: z.string().min(1),
});

export const TreeCommitActivitySchema = z.object({
  range: z.string().nullable(),
  available: z.boolean(),
  count: z.number().int().nonnegative(),
  commits: z.array(TreeCommitSummarySchema),
  bounds: ProvenanceBoundsSchema,
  detectionMethod: z.string().min(1),
  hints: z.array(z.string().min(1)),
});

export const TreeExpandSummarySchema = z.object({
  areas: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  checkout: TreeCheckoutSummarySchema,
});

export const WorktreeOverviewSummarySchema = z.object({
  focusAreas: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  checkout: TreeCheckoutSummarySchema,
});

export const DiffExpandAnchorSchema = z.object({
  kind: z.enum(ANCHOR_KIND_VALUES),
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  mappedPaths: z.array(z.string().min(1)),
});

export const ProvDiffExpandDataSchema = z.object({
  anchor: DiffExpandAnchorSchema,
  repo: ProvRepoStateDataSchema,
  file: ProvFileStateDataSchema.optional(),
  changeSummaries: z.array(DiffChangeSummarySchema),
  nearbyFiles: z.array(NearbyFileSummarySchema),
  bounds: z.object({
    changeSummaries: ProvenanceBoundsSchema,
    nearbyFiles: ProvenanceBoundsSchema,
  }),
});

export const ProvDiffExpandResultSchema = createProvenanceResultSchema(ProvDiffExpandDataSchema);

export const CommitIdentitySchema = z.object({
  commit: z.string().min(1),
  shortCommit: z.string().min(1),
  authorName: z.string().min(1),
  authorEmail: z.string().min(1),
  authoredAt: z.string().min(1),
  summary: z.string().min(1),
  parents: z.array(z.string().min(1)),
  baseRef: z.string().min(1),
  merge: z.boolean(),
  detectionMethod: z.string().min(1),
});

export const CommitStatsSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const ProvCommitMaterializeDataSchema = z.object({
  commit: CommitIdentitySchema,
  stats: CommitStatsSchema,
  touchedFiles: z.array(NearbyFileSummarySchema),
  patches: z.array(DiffChangeSummarySchema),
  bounds: z.object({
    touchedFiles: ProvenanceBoundsSchema,
    patches: ProvenanceBoundsSchema,
  }),
});

export const ProvCommitMaterializeResultSchema = createProvenanceResultSchema(
  ProvCommitMaterializeDataSchema,
);

export const ProvCommitExpandDataSchema = z.object({
  repo: ProvRepoStateDataSchema,
  materialized: ProvCommitMaterializeDataSchema,
});

export const ProvCommitExpandResultSchema = createProvenanceResultSchema(
  ProvCommitExpandDataSchema,
);

export const ProvTreeExpandDataSchema = z.object({
  anchor: TreeAnchorSchema,
  scope: TreeScopeSchema,
  repo: ProvRepoStateDataSchema,
  summary: TreeExpandSummarySchema,
  areas: z.array(TreeAreaSummarySchema),
  files: z.array(TreeFileSummarySchema),
  commits: TreeCommitActivitySchema,
  bounds: z.object({
    areas: ProvenanceBoundsSchema,
    files: ProvenanceBoundsSchema,
  }),
});

export const ProvTreeExpandResultSchema = createProvenanceResultSchema(ProvTreeExpandDataSchema);

export const ProvWorktreeOverviewDataSchema = z.object({
  scope: TreeScopeSchema,
  repo: ProvRepoStateDataSchema,
  summary: WorktreeOverviewSummarySchema,
  focusAreas: z.array(TreeAreaSummarySchema),
  files: z.array(TreeFileSummarySchema),
  commits: TreeCommitActivitySchema,
  bounds: z.object({
    focusAreas: ProvenanceBoundsSchema,
    files: ProvenanceBoundsSchema,
  }),
});

export const ProvWorktreeOverviewResultSchema = createProvenanceResultSchema(
  ProvWorktreeOverviewDataSchema,
);

export const PrMetadataSchema = z.object({
  number: z.number().int().positive(),
  title: z.string().min(1),
  url: z.string().min(1),
  state: z.string().min(1),
  isDraft: z.boolean(),
  author: z.string().nullable(),
  baseRefName: z.string().min(1),
  headRefName: z.string().min(1),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const PrChangedFileSchema = z.object({
  path: z.string().min(1),
  previousPath: z.string().min(1).optional(),
  status: z.enum(LOCAL_REPO_FILE_STATUS_VALUES),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export const PrReviewStateCountSchema = z.object({
  state: z.string().min(1),
  count: z.number().int().nonnegative(),
});

export const PrReviewContextItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["review", "review_comment", "issue_comment", "orphan_review_comment"]),
  githubId: z.number().int().positive(),
  author: z.string().min(1),
  createdAt: z.string().min(1),
  state: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  parentId: z.string().min(1).optional(),
  body: z.string(),
  bodyTruncated: z.boolean(),
});

export const PrRemoteFilesSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    totalFiles: z.number().int().nonnegative(),
    items: z.array(PrChangedFileSchema),
    bounds: ProvenanceBoundsSchema,
  }),
  z.object({
    status: z.literal("unavailable"),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
]);

export const PrRemoteReviewContextSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    counts: z.object({
      reviews: z.number().int().nonnegative(),
      reviewComments: z.number().int().nonnegative(),
      issueComments: z.number().int().nonnegative(),
      states: z.array(PrReviewStateCountSchema),
    }),
    items: z.array(PrReviewContextItemSchema),
    bounds: z.object({
      items: ProvenanceBoundsSchema,
      bytes: ProvenanceBoundsSchema,
    }),
  }),
  z.object({
    status: z.literal("unavailable"),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
]);

const PrRemoteContextBaseSchema = z.object({
  attempted: z.boolean(),
  requestedNumber: z.number().int().positive().nullable(),
  resolvedNumber: z.number().int().positive().nullable(),
  detectionMethod: z.string().min(1),
  confidence: ProvenanceConfidenceSchema,
});

export const PrRemoteContextSchema = z.discriminatedUnion("status", [
  PrRemoteContextBaseSchema.extend({
    status: z.literal("available"),
    metadata: PrMetadataSchema,
    description: BoundedTextSchema,
    files: PrRemoteFilesSchema,
    reviewContext: PrRemoteReviewContextSchema,
  }),
  PrRemoteContextBaseSchema.extend({
    status: z.literal("unavailable"),
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  PrRemoteContextBaseSchema.extend({
    status: z.literal("unsupported"),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
]);

export const PrLocalBranchSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    baseRef: z.string().min(1),
    detectionMethod: z.string().min(1),
    confidence: ProvenanceConfidenceSchema,
    files: z.array(PrChangedFileSchema),
    bounds: ProvenanceBoundsSchema,
    hints: z.array(z.string().min(1)),
  }),
  z.object({
    status: z.literal("unavailable"),
    baseRef: z.string().nullable(),
    detectionMethod: z.string().min(1),
    confidence: ProvenanceConfidenceSchema,
    code: z.string().min(1),
    message: z.string().min(1),
    hints: z.array(z.string().min(1)),
  }),
]);

export const PrFallbackSchema = z.object({
  used: z.boolean(),
  kind: z.enum(["none", "local_branch"]),
  reason: z.string().min(1).optional(),
});

export const ProvPrMaterializeDataSchema = z.object({
  repo: ProvRepoStateDataSchema.optional(),
  localBranch: PrLocalBranchSchema.optional(),
  remote: PrRemoteContextSchema,
  fallback: PrFallbackSchema,
});

export const ProvPrMaterializeResultSchema = createProvenanceResultSchema(
  ProvPrMaterializeDataSchema,
);

export const ProvPrExpandDataSchema = z.object({
  materialized: ProvPrMaterializeDataSchema,
});

export const ProvPrExpandResultSchema = createProvenanceResultSchema(ProvPrExpandDataSchema);

export type PatchHunk = z.infer<typeof PatchHunkSchema>;
export type PatchText = z.infer<typeof PatchTextSchema>;
export type PatchSummary = z.infer<typeof PatchSummarySchema>;
export type DiffChangeSummary = z.infer<typeof DiffChangeSummarySchema>;
export type NearbyFileSummary = z.infer<typeof NearbyFileSummarySchema>;
export type TreeScopeType = (typeof TREE_SCOPE_TYPE_VALUES)[number];
export type TreeAreaKind = (typeof TREE_AREA_KIND_VALUES)[number];
export type TreeStatusBreakdown = z.infer<typeof TreeStatusBreakdownSchema>;
export type TreeCheckoutSummary = z.infer<typeof TreeCheckoutSummarySchema>;
export type TreeFileSummary = z.infer<typeof TreeFileSummarySchema>;
export type TreeAreaSummary = z.infer<typeof TreeAreaSummarySchema>;
export type TreeAnchor = z.infer<typeof TreeAnchorSchema>;
export type TreeScope = z.infer<typeof TreeScopeSchema>;
export type TreeCommitSummary = z.infer<typeof TreeCommitSummarySchema>;
export type TreeCommitActivity = z.infer<typeof TreeCommitActivitySchema>;
export type ProvDiffExpandData = z.infer<typeof ProvDiffExpandDataSchema>;
export type CommitIdentity = z.infer<typeof CommitIdentitySchema>;
export type CommitMaterializedData = z.infer<typeof ProvCommitMaterializeDataSchema>;
export type ProvCommitExpandData = z.infer<typeof ProvCommitExpandDataSchema>;
export type ProvTreeExpandData = z.infer<typeof ProvTreeExpandDataSchema>;
export type ProvWorktreeOverviewData = z.infer<typeof ProvWorktreeOverviewDataSchema>;
export type BoundedText = z.infer<typeof BoundedTextSchema>;
export type PrMetadata = z.infer<typeof PrMetadataSchema>;
export type PrChangedFile = z.infer<typeof PrChangedFileSchema>;
export type PrReviewStateCount = z.infer<typeof PrReviewStateCountSchema>;
export type PrReviewContextItem = z.infer<typeof PrReviewContextItemSchema>;
export type PrRemoteFiles = z.infer<typeof PrRemoteFilesSchema>;
export type PrRemoteReviewContext = z.infer<typeof PrRemoteReviewContextSchema>;
export type PrRemoteContext = z.infer<typeof PrRemoteContextSchema>;
export type PrLocalBranchContext = z.infer<typeof PrLocalBranchSchema>;
export type PrFallback = z.infer<typeof PrFallbackSchema>;
export type ProvPrMaterializeData = z.infer<typeof ProvPrMaterializeDataSchema>;
export type ProvPrExpandData = z.infer<typeof ProvPrExpandDataSchema>;
