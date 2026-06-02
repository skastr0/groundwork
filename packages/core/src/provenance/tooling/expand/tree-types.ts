import {
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  createBoundedNumberArg,
} from "../args.ts";
import type { ProvenanceWarning } from "../contracts.ts";
import type {
  LocalRepoFileStatusKind,
  LocalRepoState,
} from "../state/internal.ts";
import type { ParsedDiffSection } from "./diff-parser.ts";
import type {
  ProvTreeExpandData,
  TreeAreaKind,
  TreeAreaSummary,
  TreeCheckoutSummary,
  TreeCommitActivity,
  TreeFileSummary,
  TreeScopeType,
  TreeStatusBreakdown,
} from "./schemas.ts";

export const TREE_DIFF_PARSE_MAX_OUTPUT_BYTES = 384_000;
export const TREE_HISTORY_PARSE_MAX_OUTPUT_BYTES = 256_000;

export const TREE_CHANGE_DETECTION_METHODS: Record<TreeScopeType, string> = {
  branch: "git diff --find-renames --unified=0 <base-ref>..HEAD -- <path>",
  staged: "git diff --cached --find-renames --unified=0 -- <path>",
  working_tree:
    "git diff --find-renames --unified=0 -- <path> + git diff --cached --find-renames --unified=0 -- <path> + synthetic untracked patches",
};

export const TREE_COMMIT_ACTIVITY_DETECTION_METHOD =
  "git rev-list --count <base-ref>..HEAD -- <path> + git log -n --format <base-ref>..HEAD -- <path>";

export const AREA_SAMPLE_PATH_LIMIT = 3;

export const STATUS_PRIORITY: Record<LocalRepoFileStatusKind, number> = {
  unknown: 0,
  modified: 1,
  added: 2,
  deleted: 3,
  copied: 4,
  renamed: 5,
};

export const treeSummaryLimitArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_ITEM_LIMIT,
  description: "Max area, file, and commit summaries to return",
});

export type ResolvedTreeAnchor = {
  requestedPath: string;
  resolvedPath: string;
  kind: TreeAreaKind;
  warnings: ProvenanceWarning[];
};

export type MatchedSection = {
  section: ParsedDiffSection;
  matchedPath: string;
};

export type ScopedTreeSections = {
  sections: ParsedDiffSection[];
  changeDetectionMethod: string;
  warnings: ProvenanceWarning[];
};

export type MutableAreaSummary = {
  path: string;
  depth: number;
  kind: TreeAreaKind;
  changedFiles: number;
  additions: number;
  deletions: number;
  statuses: TreeStatusBreakdown;
  checkout: TreeCheckoutSummary;
  samplePaths: Set<string>;
};

export type TreeExpandCoreArgs = {
  path: string;
  base?: string;
  scope?: TreeScopeType;
  limit?: number;
  max_bytes?: number;
  max_depth?: number;
};

export type TreeExpandLoadContext = {
  rootDir: string;
  scope: TreeScopeType;
  maxDepth: number;
  anchor: ResolvedTreeAnchor;
  repoState: LocalRepoState;
  scopedSections: ScopedTreeSections;
};

export type TreeExpandAssembly = {
  summary: ProvTreeExpandData["summary"];
  areas: TreeAreaSummary[];
  files: TreeFileSummary[];
  commits: TreeCommitActivity;
  bounds: ProvTreeExpandData["bounds"];
};

export function comparePaths(left: string, right: string): number {
  return left.localeCompare(right);
}
