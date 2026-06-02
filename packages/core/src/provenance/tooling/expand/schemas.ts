import { z } from "zod";
import { DEFAULT_PROVENANCE_ITEM_LIMIT, createBoundedNumberArg } from "../args.ts";
import type { ProvenanceBounds, ProvenanceConfidence } from "../contracts.ts";
import {
  type LocalRepoFileStatusKind,
  type ProvFileStateData,
  type ProvRepoStateData,
} from "../state/internal.ts";

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

export const TREE_SCOPE_TYPE_VALUES = ["branch", "working_tree", "staged"] as const;
export const TREE_AREA_KIND_VALUES = ["root", "directory", "package"] as const;

export interface PatchHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  additions: number;
  deletions: number;
}
export interface PatchText {
  included: boolean;
  value?: string;
  bounds: ProvenanceBounds;
  byteCount: number;
}
export interface PatchSummary {
  additions: number;
  deletions: number;
  hunkCount: number;
  hunks: PatchHunk[];
  hunkBounds: ProvenanceBounds;
  text: PatchText;
  hints: string[];
}
export interface DiffChangeSummary {
  key: ChangeContextKey;
  fromRef: string | null;
  toRef: string | null;
  path: string;
  oldPath?: string;
  status: LocalRepoFileStatusKind;
  patch: PatchSummary;
}
export interface NearbyFileSummary {
  key: ChangeContextKey;
  fromRef: string | null;
  toRef: string | null;
  path: string;
  oldPath?: string;
  status: LocalRepoFileStatusKind;
  additions: number;
  deletions: number;
  hunkCount: number;
}
export type TreeScopeType = (typeof TREE_SCOPE_TYPE_VALUES)[number];
export type TreeAreaKind = (typeof TREE_AREA_KIND_VALUES)[number];
export interface TreeStatusBreakdown {
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
  copied: number;
  unknown: number;
}
export interface TreeCheckoutSummary {
  staged: number;
  unstaged: number;
  untracked: number;
}
export interface TreeFileSummary extends NearbyFileSummary {
  matchedPath: string;
}
export interface TreeAreaSummary {
  path: string;
  kind: TreeAreaKind;
  depth: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  statuses: TreeStatusBreakdown;
  checkout: TreeCheckoutSummary;
  samplePaths: string[];
}
export interface TreeAnchor {
  requestedPath: string;
  resolvedPath: string;
  kind: TreeAreaKind;
}
export interface TreeScope {
  type: TreeScopeType;
  branchName: string | null;
  baseRef: string | null;
  baseDetectionMethod: string;
  changeDetectionMethod: string;
}
export interface TreeCommitSummary {
  commit: string;
  shortCommit: string;
  authorName: string;
  authoredAt: string;
  summary: string;
}
export interface TreeCommitActivity {
  range: string | null;
  available: boolean;
  count: number;
  commits: TreeCommitSummary[];
  bounds: ProvenanceBounds;
  detectionMethod: string;
  hints: string[];
}
export interface TreeExpandSummary {
  areas: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  commits: number;
  checkout: TreeCheckoutSummary;
}
export interface WorktreeOverviewSummary {
  focusAreas: number;
  changedFiles: number;
  additions: number;
  deletions: number;
  commits: number;
  checkout: TreeCheckoutSummary;
}
export interface DiffExpandAnchor {
  kind: (typeof ANCHOR_KIND_VALUES)[number];
  requestedPath: string;
  resolvedPath: string;
  mappedPaths: string[];
}
export interface ProvDiffExpandData {
  anchor: DiffExpandAnchor;
  repo: ProvRepoStateData;
  file?: ProvFileStateData;
  changeSummaries: DiffChangeSummary[];
  nearbyFiles: NearbyFileSummary[];
  bounds: {
    changeSummaries: ProvenanceBounds;
    nearbyFiles: ProvenanceBounds;
  };
}
export interface CommitIdentity {
  commit: string;
  shortCommit: string;
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  summary: string;
  parents: string[];
  baseRef: string;
  merge: boolean;
  detectionMethod: string;
}
export interface CommitStats {
  filesChanged: number;
  additions: number;
  deletions: number;
}
export interface CommitMaterializedData {
  commit: CommitIdentity;
  stats: CommitStats;
  touchedFiles: NearbyFileSummary[];
  patches: DiffChangeSummary[];
  bounds: {
    touchedFiles: ProvenanceBounds;
    patches: ProvenanceBounds;
  };
}
export interface ProvCommitExpandData {
  repo: ProvRepoStateData;
  materialized: CommitMaterializedData;
}
export interface ProvTreeExpandData {
  anchor: TreeAnchor;
  scope: TreeScope;
  repo: ProvRepoStateData;
  summary: TreeExpandSummary;
  areas: TreeAreaSummary[];
  files: TreeFileSummary[];
  commits: TreeCommitActivity;
  bounds: {
    areas: ProvenanceBounds;
    files: ProvenanceBounds;
  };
}
export interface ProvWorktreeOverviewData {
  scope: TreeScope;
  repo: ProvRepoStateData;
  summary: WorktreeOverviewSummary;
  focusAreas: TreeAreaSummary[];
  files: TreeFileSummary[];
  commits: TreeCommitActivity;
  bounds: {
    focusAreas: ProvenanceBounds;
    files: ProvenanceBounds;
  };
}
export interface BoundedText {
  text: string;
  bounds: ProvenanceBounds;
  byteCount: number;
}
export interface PrMetadata {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: string | null;
  baseRefName: string;
  headRefName: string;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface PrChangedFile {
  path: string;
  previousPath?: string;
  status: LocalRepoFileStatusKind;
  additions: number;
  deletions: number;
}
export interface PrReviewStateCount {
  state: string;
  count: number;
}
export type PrReviewContextItemType =
  | "review"
  | "review_comment"
  | "issue_comment"
  | "orphan_review_comment";
export interface PrReviewContextItem {
  id: string;
  type: PrReviewContextItemType;
  githubId: number;
  author: string;
  createdAt: string;
  state?: string;
  path?: string;
  line?: number;
  parentId?: string;
  body: string;
  bodyTruncated: boolean;
}
export type PrRemoteFiles =
  | {
      status: "available";
      totalFiles: number;
      items: PrChangedFile[];
      bounds: ProvenanceBounds;
    }
  | {
      status: "unavailable";
      code: string;
      message: string;
    };
export type PrRemoteReviewContext =
  | {
      status: "available";
      counts: {
        reviews: number;
        reviewComments: number;
        issueComments: number;
        states: PrReviewStateCount[];
      };
      items: PrReviewContextItem[];
      bounds: {
        items: ProvenanceBounds;
        bytes: ProvenanceBounds;
      };
    }
  | {
      status: "unavailable";
      code: string;
      message: string;
    };
interface PrRemoteContextBase {
  attempted: boolean;
  requestedNumber: number | null;
  resolvedNumber: number | null;
  detectionMethod: string;
  confidence: ProvenanceConfidence;
}
export type PrRemoteContext =
  | (PrRemoteContextBase & {
      status: "available";
      metadata: PrMetadata;
      description: BoundedText;
      files: PrRemoteFiles;
      reviewContext: PrRemoteReviewContext;
    })
  | (PrRemoteContextBase & {
      status: "unavailable";
      code: string;
      message: string;
      retryable: boolean;
    })
  | (PrRemoteContextBase & {
      status: "unsupported";
      code: string;
      message: string;
    });
export type PrLocalBranchContext =
  | {
      status: "available";
      baseRef: string;
      detectionMethod: string;
      confidence: ProvenanceConfidence;
      files: PrChangedFile[];
      bounds: ProvenanceBounds;
      hints: string[];
    }
  | {
      status: "unavailable";
      baseRef: string | null;
      detectionMethod: string;
      confidence: ProvenanceConfidence;
      code: string;
      message: string;
      hints: string[];
    };
export interface PrFallback {
  used: boolean;
  kind: "none" | "local_branch";
  reason?: string;
}
export interface ProvPrMaterializeData {
  repo?: ProvRepoStateData;
  localBranch?: PrLocalBranchContext;
  remote: PrRemoteContext;
  fallback: PrFallback;
}
export interface ProvPrExpandData {
  materialized: ProvPrMaterializeData;
}
