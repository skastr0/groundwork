import type { PluginInput } from "@opencode-ai/plugin";
import type { ProvenanceAmbiguity, ProvenanceConfidence } from "../contracts.ts";

export type Shell = PluginInput["$"];

export const LOCAL_REPO_FILE_STATUS_VALUES = [
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "unknown",
] as const;

export type LocalRepoFileStatusKind = (typeof LOCAL_REPO_FILE_STATUS_VALUES)[number];

export interface LocalRepoFileStatus {
  status: LocalRepoFileStatusKind;
  path: string;
  newPath?: string;
}

export const LOCAL_BASE_DETECTION_KIND_VALUES = [
  "explicit",
  "remote_head_symbolic_ref",
  "default_branch",
  "tracking_branch",
  "first_remote_branch",
  "none",
] as const;

export type LocalBaseDetectionKind = (typeof LOCAL_BASE_DETECTION_KIND_VALUES)[number];

export interface LocalBaseDetection {
  kind: LocalBaseDetectionKind;
  label: string;
  explicit: boolean;
  method: string;
  confidence: ProvenanceConfidence;
}

export interface LocalCurrentBranchState {
  name: string | null;
  ref: string | null;
  detached: boolean;
  upstream: string | null;
  hasMatchingRemoteBranch: boolean;
  isLocalOnly: boolean;
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}

export interface LocalHeadState {
  ref: "HEAD";
  commit: string | null;
  shortCommit: string | null;
  detached: boolean;
  branchName: string | null;
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}

export interface LocalBaseState {
  ref: string | null;
  branchName: string | null;
  detection: LocalBaseDetection;
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}

export interface LocalIndexState {
  ref: "index";
  dirty: boolean;
  count: number;
  files: LocalRepoFileStatus[];
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}

export interface LocalWorktreeState {
  ref: "worktree";
  dirty: boolean;
  count: number;
  files: LocalRepoFileStatus[];
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}

export interface LocalUntrackedFilesState {
  ref: "worktree";
  files: string[];
  count: number;
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}

export const LOCAL_REPO_AMBIGUITY_CODE_VALUES = [
  "base_not_found",
  "detached_head",
  "missing_upstream",
  "local_only_branch",
  "dirty_worktree",
] as const;

export type LocalRepoAmbiguityCode = (typeof LOCAL_REPO_AMBIGUITY_CODE_VALUES)[number];

export interface LocalRepoAmbiguityIssue {
  code: LocalRepoAmbiguityCode;
  level: ProvenanceAmbiguity;
  message: string;
}

export interface LocalRepoAmbiguityState {
  level: ProvenanceAmbiguity;
  issues: LocalRepoAmbiguityIssue[];
}

export interface LocalRepoState {
  currentBranch: LocalCurrentBranchState;
  head: LocalHeadState;
  base: LocalBaseState;
  confidence: ProvenanceConfidence;
  detectionMethod: string;
  index: LocalIndexState;
  worktree: LocalWorktreeState;
  untracked: LocalUntrackedFilesState;
  ambiguity: LocalRepoAmbiguityState;
}

export const LOCAL_FILE_COMPARISON_STATUS_VALUES = [
  "unchanged",
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "type_changed",
  "unknown",
] as const;

export type LocalFileComparisonStatus = (typeof LOCAL_FILE_COMPARISON_STATUS_VALUES)[number];

export interface LocalFileLayerState {
  ref: string | null;
  path: string;
  exists: boolean;
  mode: string | null;
  objectId: string | null;
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}

export interface LocalFileComparison {
  fromRef: string;
  toRef: string;
  fromPath: string;
  toPath: string;
  status: LocalFileComparisonStatus;
  detected: boolean;
  detectionMethod: string;
}

export interface LocalFileState {
  requestedPath: string;
  resolvedPath: string;
  confidence: ProvenanceConfidence;
  ambiguity: LocalRepoAmbiguityState;
  detectionMethod: string;
  base: LocalFileLayerState;
  head: LocalFileLayerState;
  index: LocalFileLayerState;
  worktree: LocalFileLayerState;
  comparisons: {
    baseToHead: LocalFileComparison;
    headToIndex: LocalFileComparison;
    indexToWorktree: LocalFileComparison;
  };
}

export const BRANCH_DETECTION_METHOD =
  "git branch --show-current + git config branch.* + git branch -r";
export const HEAD_DETECTION_METHOD = "git rev-parse --verify HEAD";
export const INDEX_DETECTION_METHOD = "git status --porcelain";
export const WORKTREE_DETECTION_METHOD = "git status --porcelain";
export const UNTRACKED_DETECTION_METHOD = "git ls-files --others --exclude-standard";
export const REPO_STATE_DETECTION_METHOD = "git local repo inspection";
export const BASE_FILE_DETECTION_METHOD = "git ls-tree -l <base-ref> -- <path>";
export const HEAD_FILE_DETECTION_METHOD = "git ls-tree -l HEAD -- <path>";
export const INDEX_FILE_DETECTION_METHOD = "git ls-files --stage -- <path>";
export const WORKTREE_FILE_DETECTION_METHOD =
  "git diff --name-status -M -- + git ls-files --others --exclude-standard";
export const BASE_TO_HEAD_FILE_DIFF_METHOD = "git diff --name-status -M <base-ref>..HEAD --";
export const HEAD_TO_INDEX_FILE_DIFF_METHOD = "git diff --cached --name-status -M --";
export const INDEX_TO_WORKTREE_FILE_DIFF_METHOD = "git diff --name-status -M --";
export const FILE_STATE_DETECTION_METHOD = "git local file inspection";
