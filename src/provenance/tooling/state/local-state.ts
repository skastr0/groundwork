import type { PluginInput } from "@opencode-ai/plugin";
import {
  runOptionalProcessText,
  runProcessText,
  type ProcessCommand,
} from "../../../../shared/effect-runtime.ts";
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

type LocalStatusSnapshot = {
  indexFiles: LocalRepoFileStatus[];
  worktreeFiles: LocalRepoFileStatus[];
};

type LocalDiffEntry = {
  status: Exclude<LocalFileComparisonStatus, "unchanged">;
  path: string;
  newPath?: string;
};

type GitPathMetadata = {
  exists: boolean;
  mode: string | null;
  objectId: string | null;
};

type LocalFilePathKey = "base" | "head" | "index" | "worktree";

type LocalFilePathChain = Record<LocalFilePathKey, string>;

type LocalFilePathResolution = {
  paths: LocalFilePathChain;
  entries: {
    baseToHead: LocalDiffEntry | null;
    headToIndex: LocalDiffEntry | null;
    indexToWorktree: LocalDiffEntry | null;
  };
};

type LocalFileDiffEntries = {
  baseToHead: LocalDiffEntry[];
  headToIndex: LocalDiffEntry[];
  indexToWorktree: LocalDiffEntry[];
};

type LocalFileMetadataLayers = {
  base: GitPathMetadata;
  head: GitPathMetadata;
  index: GitPathMetadata;
};

type LocalFileComparisonLayers = LocalFileState["comparisons"];

type LocalFileTrackedLayers = Pick<LocalFileState, "base" | "head" | "index">;

const DEFAULT_BASE_BRANCHES = ["main", "master", "develop", "development"] as const;

const STATUS_PRIORITY: Record<LocalRepoFileStatusKind, number> = {
  unknown: 0,
  modified: 1,
  added: 2,
  deleted: 3,
  copied: 4,
  renamed: 5,
};

const AMBIGUITY_PRIORITY: Record<ProvenanceAmbiguity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const CONFIDENCE_PRIORITY: Record<ProvenanceConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const BRANCH_DETECTION_METHOD = "git branch --show-current + git config branch.* + git branch -r";
const HEAD_DETECTION_METHOD = "git rev-parse --verify HEAD";
const INDEX_DETECTION_METHOD = "git status --porcelain";
const WORKTREE_DETECTION_METHOD = "git status --porcelain";
const UNTRACKED_DETECTION_METHOD = "git ls-files --others --exclude-standard";
const REPO_STATE_DETECTION_METHOD = "git local repo inspection";
const BASE_FILE_DETECTION_METHOD = "git ls-tree -l <base-ref> -- <path>";
const HEAD_FILE_DETECTION_METHOD = "git ls-tree -l HEAD -- <path>";
const INDEX_FILE_DETECTION_METHOD = "git ls-files --stage -- <path>";
const WORKTREE_FILE_DETECTION_METHOD =
  "git diff --name-status -M -- + git ls-files --others --exclude-standard";
const BASE_TO_HEAD_FILE_DIFF_METHOD = "git diff --name-status -M <base-ref>..HEAD --";
const HEAD_TO_INDEX_FILE_DIFF_METHOD = "git diff --cached --name-status -M --";
const INDEX_TO_WORKTREE_FILE_DIFF_METHOD = "git diff --name-status -M --";
const FILE_STATE_DETECTION_METHOD = "git local file inspection";

function toBaseDetectionMethod(kind: LocalBaseDetectionKind): string {
  switch (kind) {
    case "explicit":
      return "explicit base input";
    case "remote_head_symbolic_ref":
      return "git symbolic-ref refs/remotes/origin/HEAD";
    case "default_branch":
      return "default branch candidate scan";
    case "tracking_branch":
      return "branch.<name>.merge + branch.<name>.remote";
    case "first_remote_branch":
      return "git branch -r";
    case "none":
      return "no local base detected";
  }
}

function getBranchConfidence(options: {
  branchName: string | null;
  upstream: string | null;
  hasMatchingRemoteBranch: boolean;
}): ProvenanceConfidence {
  if (!options.branchName) {
    return "unknown";
  }

  if (!options.upstream || !options.hasMatchingRemoteBranch) {
    return "medium";
  }

  return "high";
}

function getBaseConfidence(
  ref: string | null,
  detection: Pick<LocalBaseDetection, "kind">,
): ProvenanceConfidence {
  if (!ref) {
    return detection.kind === "none" ? "unknown" : "low";
  }

  switch (detection.kind) {
    case "explicit":
      return "high";
    case "default_branch":
      return ref.startsWith("origin/") ? "medium" : "high";
    case "remote_head_symbolic_ref":
    case "tracking_branch":
      return "medium";
    case "first_remote_branch":
      return "low";
    case "none":
      return "unknown";
  }
}

function getHighestConfidence(confidences: readonly ProvenanceConfidence[]): ProvenanceConfidence {
  let highest: ProvenanceConfidence = "unknown";

  for (const confidence of confidences) {
    if (CONFIDENCE_PRIORITY[confidence] > CONFIDENCE_PRIORITY[highest]) {
      highest = confidence;
    }
  }

  return highest;
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

async function readTextOrEmpty(
  shell: Shell,
  cmd: ProcessCommand,
  options: { trim?: boolean } = {},
): Promise<string> {
  return runOptionalProcessText({
    shell,
    cmd,
    trim: options.trim,
  });
}

async function refExists(shell: Shell, ref: string): Promise<boolean> {
  const value = await readTextOrEmpty(shell, ["git", "rev-parse", "--verify", ref]);
  return value.length > 0;
}

function getExplicitBaseCandidates(explicitBase: string): string[] {
  const trimmed = explicitBase.trim();
  if (!trimmed) {
    return [];
  }

  const directCandidates = [trimmed];
  if (trimmed.startsWith("refs/remotes/")) {
    directCandidates.push(trimmed.replace(/^refs\/remotes\//, ""));
  } else if (trimmed.startsWith("refs/heads/")) {
    directCandidates.push(trimmed.replace(/^refs\/heads\//, ""));
  }

  const remoteCandidates = directCandidates
    .filter((candidate) => !candidate.startsWith("origin/") && !candidate.startsWith("refs/"))
    .map((candidate) => `origin/${candidate}`);

  return [...new Set([...directCandidates, ...remoteCandidates])];
}

function extractBranchNameFromRef(ref: string | null): string | null {
  if (!ref) return null;

  if (ref.startsWith("refs/heads/")) {
    return ref.slice("refs/heads/".length);
  }

  if (ref.startsWith("refs/remotes/")) {
    const stripped = ref.slice("refs/remotes/".length);
    const slashIndex = stripped.indexOf("/");
    return slashIndex === -1 ? stripped : stripped.slice(slashIndex + 1);
  }

  const slashIndex = ref.indexOf("/");
  return slashIndex === -1 ? ref : ref.slice(slashIndex + 1);
}

function normalizeStatus(code: string, fallbackPath: string): LocalRepoFileStatus {
  const trimmed = fallbackPath.trim();

  if (code.includes("R") || trimmed.includes(" -> ")) {
    const [from, to] = trimmed.split(" -> ");
    if (from && to) {
      return {
        status: "renamed",
        path: from,
        newPath: to,
      };
    }

    return {
      status: "renamed",
      path: trimmed,
    };
  }

  if (code.includes("C")) {
    return {
      status: "copied",
      path: trimmed,
    };
  }

  if (code.includes("D")) {
    return {
      status: "deleted",
      path: trimmed,
    };
  }

  if (code.includes("A")) {
    return {
      status: "added",
      path: trimmed,
    };
  }

  if (code.includes("M")) {
    return {
      status: "modified",
      path: trimmed,
    };
  }

  return {
    status: "unknown",
    path: trimmed,
  };
}

function mergeFileStatuses(files: LocalRepoFileStatus[]): LocalRepoFileStatus[] {
  const merged = new Map<string, LocalRepoFileStatus>();

  for (const file of files) {
    const key = file.newPath ?? file.path;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, file);
      continue;
    }

    if (STATUS_PRIORITY[file.status] >= STATUS_PRIORITY[existing.status]) {
      merged.set(key, file);
    }
  }

  return [...merged.values()].sort((left, right) => {
    const leftPath = left.newPath ?? left.path;
    const rightPath = right.newPath ?? right.path;
    return leftPath.localeCompare(rightPath);
  });
}

function parseLocalStatusSnapshot(raw: string): LocalStatusSnapshot {
  const indexFiles: LocalRepoFileStatus[] = [];
  const worktreeFiles: LocalRepoFileStatus[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim() || line.startsWith("!!")) continue;

    const xy = line.slice(0, 2);
    const pathPart = line.length >= 3 ? line.slice(3) : "";
    if (!pathPart.trim() || xy === "??") continue;

    const stagedCode = xy.charAt(0);
    const unstagedCode = xy.charAt(1);

    if (stagedCode && stagedCode !== " ") {
      indexFiles.push(normalizeStatus(stagedCode, pathPart));
    }

    if (unstagedCode && unstagedCode !== " ") {
      worktreeFiles.push(normalizeStatus(unstagedCode, pathPart));
    }
  }

  return {
    indexFiles: mergeFileStatuses(indexFiles),
    worktreeFiles: mergeFileStatuses(worktreeFiles),
  };
}

function normalizeFileComparisonStatus(
  code: string,
): Exclude<LocalFileComparisonStatus, "unchanged"> {
  const normalized = code.trim().charAt(0);

  switch (normalized) {
    case "A":
      return "added";
    case "C":
      return "copied";
    case "D":
      return "deleted";
    case "M":
      return "modified";
    case "R":
      return "renamed";
    case "T":
      return "type_changed";
    default:
      return "unknown";
  }
}

function parseNameStatusEntries(raw: string): LocalDiffEntry[] {
  const entries: LocalDiffEntry[] = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;

    const parts = line.split("\t").filter((part) => part.length > 0);
    if (parts.length < 2) continue;

    const statusCode = parts[0] ?? "";
    const path = parts[1]?.trim();
    if (!path) continue;

    const status = normalizeFileComparisonStatus(statusCode);
    if ((status === "renamed" || status === "copied") && parts[2]?.trim()) {
      entries.push({
        status,
        path,
        newPath: parts[2]?.trim(),
      });
      continue;
    }

    entries.push({
      status,
      path,
    });
  }

  return entries;
}

function findMatchingDiffEntry(
  entries: readonly LocalDiffEntry[],
  candidates: readonly string[],
): LocalDiffEntry | null {
  const normalizedCandidates = [
    ...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean)),
  ];

  for (const candidate of normalizedCandidates) {
    const directMatch = entries.find((entry) => entry.path === candidate);
    if (directMatch) {
      return directMatch;
    }

    const renamedMatch = entries.find((entry) => entry.newPath === candidate);
    if (renamedMatch) {
      return renamedMatch;
    }
  }

  return null;
}

function getDiffEntryPaths(entry: LocalDiffEntry): { fromPath: string; toPath: string } {
  return {
    fromPath: entry.path,
    toPath: entry.newPath ?? entry.path,
  };
}

function resolveFilePaths(options: {
  requestedPath: string;
  baseToHeadEntries: readonly LocalDiffEntry[];
  headToIndexEntries: readonly LocalDiffEntry[];
  indexToWorktreeEntries: readonly LocalDiffEntry[];
}): LocalFilePathResolution {
  const paths: LocalFilePathChain = {
    base: options.requestedPath,
    head: options.requestedPath,
    index: options.requestedPath,
    worktree: options.requestedPath,
  };
  const entries: LocalFilePathResolution["entries"] = {
    baseToHead: null,
    headToIndex: null,
    indexToWorktree: null,
  };
  const transitions: Array<{
    key: keyof LocalFilePathResolution["entries"];
    from: LocalFilePathKey;
    to: LocalFilePathKey;
    entries: readonly LocalDiffEntry[];
  }> = [
    {
      key: "baseToHead",
      from: "base",
      to: "head",
      entries: options.baseToHeadEntries,
    },
    {
      key: "headToIndex",
      from: "head",
      to: "index",
      entries: options.headToIndexEntries,
    },
    {
      key: "indexToWorktree",
      from: "index",
      to: "worktree",
      entries: options.indexToWorktreeEntries,
    },
  ];

  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;

    for (const transition of transitions) {
      const matchedEntry = findMatchingDiffEntry(transition.entries, [
        paths[transition.from],
        paths[transition.to],
      ]);
      if (!matchedEntry) continue;

      entries[transition.key] = matchedEntry;
      const { fromPath, toPath } = getDiffEntryPaths(matchedEntry);
      if (paths[transition.from] !== fromPath) {
        paths[transition.from] = fromPath;
        changed = true;
      }
      if (paths[transition.to] !== toPath) {
        paths[transition.to] = toPath;
        changed = true;
      }
    }

    if (!changed) {
      break;
    }
  }

  return {
    paths,
    entries,
  };
}

function parseGitTreeMetadata(raw: string): GitPathMetadata {
  const line = raw
    .split("\n")
    .map((value) => value.trimEnd())
    .find((value) => value.length > 0);
  if (!line) {
    return missingGitPathMetadata();
  }

  const match = line.match(/^(\d+)\s+\w+\s+([0-9a-f]+)\s+(?:-|\d+)\t.+$/i);
  return {
    exists: true,
    mode: match?.[1] ?? null,
    objectId: match?.[2] ?? null,
  };
}

function parseIndexMetadata(raw: string): GitPathMetadata {
  const line = raw
    .split("\n")
    .map((value) => value.trimEnd())
    .find((value) => value.length > 0);
  if (!line) {
    return missingGitPathMetadata();
  }

  const match = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t.+$/i);
  return {
    exists: true,
    mode: match?.[1] ?? null,
    objectId: match?.[2] ?? null,
  };
}

async function readGitTreeMetadata(
  shell: Shell,
  ref: string,
  filePath: string,
): Promise<GitPathMetadata> {
  const raw = await readTextOrEmpty(shell, ["git", "ls-tree", "-l", ref, "--", filePath], {
    trim: false,
  });
  return parseGitTreeMetadata(raw);
}

async function readIndexMetadata(shell: Shell, filePath: string): Promise<GitPathMetadata> {
  const raw = await readTextOrEmpty(shell, ["git", "ls-files", "--stage", "--", filePath], {
    trim: false,
  });
  return parseIndexMetadata(raw);
}

async function readNameStatusEntries(shell: Shell, cmd: ProcessCommand): Promise<LocalDiffEntry[]> {
  const raw = await readTextOrEmpty(shell, cmd, { trim: false });
  return parseNameStatusEntries(raw);
}

function toFileLayerState(options: {
  ref: string | null;
  path: string;
  metadata: GitPathMetadata;
  confidence: ProvenanceConfidence;
  detectionMethod: string;
}): LocalFileLayerState {
  return {
    ref: options.ref,
    path: options.path,
    exists: options.metadata.exists,
    mode: options.metadata.mode,
    objectId: options.metadata.objectId,
    confidence: options.confidence,
    detectionMethod: options.detectionMethod,
  };
}

function toFileComparison(options: {
  fromRef: string | null;
  toRef: string;
  fromPath: string;
  toPath: string;
  entry: LocalDiffEntry | null;
  detectionMethod: string;
}): LocalFileComparison {
  return {
    fromRef: options.fromRef ?? "base",
    toRef: options.toRef,
    fromPath: options.fromPath,
    toPath: options.toPath,
    status: options.entry?.status ?? (options.fromRef ? "unchanged" : "unknown"),
    detected: options.entry !== null,
    detectionMethod: options.detectionMethod,
  };
}

function resolveLatestPath(layers: {
  base: LocalFileLayerState;
  head: LocalFileLayerState;
  index: LocalFileLayerState;
  worktree: LocalFileLayerState;
}): string {
  if (layers.worktree.exists) return layers.worktree.path;
  if (layers.index.exists) return layers.index.path;
  if (layers.head.exists) return layers.head.path;
  if (layers.base.exists) return layers.base.path;
  return layers.worktree.path;
}

function worktreeExists(options: {
  path: string;
  index: LocalFileLayerState;
  comparison: LocalFileComparison;
  untrackedFiles: readonly string[];
}): boolean {
  if (options.untrackedFiles.includes(options.path)) {
    return true;
  }

  switch (options.comparison.status) {
    case "added":
    case "copied":
    case "modified":
    case "renamed":
    case "type_changed":
      return true;
    case "deleted":
      return false;
    case "unchanged":
    case "unknown":
      return options.index.exists;
  }
}

async function getStatusSnapshot(shell: Shell): Promise<LocalStatusSnapshot> {
  const raw = await runProcessText({
    shell,
    cmd: ["git", "status", "--porcelain"],
    trim: false,
  });
  return parseLocalStatusSnapshot(raw);
}

async function listRemoteBranches(shell: Shell): Promise<string[]> {
  const raw = await runProcessText({
    shell,
    cmd: ["git", "branch", "-r"],
    trim: false,
  });
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.includes(" -> "));
}

function buildTrackingRef(remoteName: string, mergeRef: string): string {
  return `${remoteName}/${mergeRef.replace(/^refs\/heads\//, "")}`;
}

function hasMatchingRemoteBranch(
  branchName: string,
  remoteBranches: readonly string[],
  upstream: string | null,
): boolean {
  if (upstream && remoteBranches.includes(upstream)) {
    return true;
  }

  return remoteBranches.some(
    (remoteBranch) => extractBranchNameFromRef(remoteBranch) === branchName,
  );
}

function toBaseState(ref: string | null, detection: LocalBaseDetection): LocalBaseState {
  return {
    ref,
    branchName: extractBranchNameFromRef(ref),
    detection,
    confidence: detection.confidence,
    detectionMethod: detection.method,
  };
}

async function getHeadCommit(shell: Shell): Promise<string | null> {
  const commit = await readTextOrEmpty(shell, ["git", "rev-parse", "--verify", "HEAD"]);
  return commit || null;
}

function toHeadState(
  currentBranch: LocalCurrentBranchState,
  commit: string | null,
): LocalHeadState {
  return {
    ref: "HEAD",
    commit,
    shortCommit: commit ? commit.slice(0, 12) : null,
    detached: currentBranch.detached,
    branchName: currentBranch.name,
    confidence: commit ? "high" : "unknown",
    detectionMethod: HEAD_DETECTION_METHOD,
  };
}

function getLocalRepoConfidence(state: {
  ambiguity: LocalRepoAmbiguityState;
  currentBranch: LocalCurrentBranchState;
  base: LocalBaseState;
  head: LocalHeadState;
  index: LocalIndexState;
  worktree: LocalWorktreeState;
  untracked: LocalUntrackedFilesState;
}): ProvenanceConfidence {
  const sectionFloor = getLowestConfidence([
    state.currentBranch.confidence,
    state.base.confidence,
    state.head.confidence,
    state.index.confidence,
    state.worktree.confidence,
    state.untracked.confidence,
  ]);

  if (state.ambiguity.level === "high") {
    return sectionFloor === "unknown" ? "unknown" : "low";
  }

  if (sectionFloor === "low") {
    return "low";
  }

  if (state.ambiguity.level === "medium" || state.ambiguity.level === "low") {
    return getHighestConfidence([sectionFloor, "medium"]);
  }

  return sectionFloor;
}

function getHighestAmbiguity(issues: readonly LocalRepoAmbiguityIssue[]): ProvenanceAmbiguity {
  let highest: ProvenanceAmbiguity = "none";

  for (const issue of issues) {
    if (AMBIGUITY_PRIORITY[issue.level] > AMBIGUITY_PRIORITY[highest]) {
      highest = issue.level;
    }
  }

  return highest;
}

function buildAmbiguityState(state: {
  currentBranch: LocalCurrentBranchState;
  base: LocalBaseState;
  index: LocalIndexState;
  worktree: LocalWorktreeState;
  untracked: LocalUntrackedFilesState;
}): LocalRepoAmbiguityState {
  const issues: LocalRepoAmbiguityIssue[] = [];

  if (!state.base.ref) {
    issues.push({
      code: "base_not_found",
      level: "high",
      message: "Could not resolve a local-only base ref for the current repository state.",
    });
  }

  if (state.currentBranch.detached) {
    issues.push({
      code: "detached_head",
      level: "high",
      message: "HEAD is detached, so branch-relative provenance may be ambiguous.",
    });
  } else if (!state.currentBranch.upstream) {
    issues.push({
      code: "missing_upstream",
      level: "medium",
      message: `Current branch '${state.currentBranch.name}' has no configured upstream branch.`,
    });
  }

  if (!state.currentBranch.detached && state.currentBranch.isLocalOnly) {
    issues.push({
      code: "local_only_branch",
      level: "medium",
      message: `Current branch '${state.currentBranch.name}' has no matching remote branch.`,
    });
  }

  if (state.index.dirty || state.worktree.dirty || state.untracked.count > 0) {
    issues.push({
      code: "dirty_worktree",
      level: "low",
      message:
        "Local index/worktree has uncommitted changes or untracked files, so provenance is relative to a dirty checkout.",
    });
  }

  return {
    level: getHighestAmbiguity(issues),
    issues,
  };
}

export async function getCurrentBranchState(shell: Shell): Promise<LocalCurrentBranchState> {
  const [branchName, remoteBranches] = await Promise.all([
    runProcessText({
      shell,
      cmd: ["git", "branch", "--show-current"],
    }),
    listRemoteBranches(shell),
  ]);

  if (!branchName) {
    return {
      name: null,
      ref: null,
      detached: true,
      upstream: null,
      hasMatchingRemoteBranch: false,
      isLocalOnly: false,
      confidence: "unknown",
      detectionMethod: BRANCH_DETECTION_METHOD,
    };
  }

  const [mergeRef, remoteName] = await Promise.all([
    readTextOrEmpty(shell, ["git", "config", "--get", `branch.${branchName}.merge`]),
    readTextOrEmpty(shell, ["git", "config", "--get", `branch.${branchName}.remote`]),
  ]);

  const upstream = mergeRef && remoteName ? buildTrackingRef(remoteName, mergeRef) : null;
  const matchingRemoteBranch = hasMatchingRemoteBranch(branchName, remoteBranches, upstream);

  return {
    name: branchName,
    ref: `refs/heads/${branchName}`,
    detached: false,
    upstream,
    hasMatchingRemoteBranch: matchingRemoteBranch,
    isLocalOnly: !matchingRemoteBranch,
    confidence: getBranchConfidence({
      branchName,
      upstream,
      hasMatchingRemoteBranch: matchingRemoteBranch,
    }),
    detectionMethod: BRANCH_DETECTION_METHOD,
  };
}

export async function getHeadState(
  shell: Shell,
  currentBranch?: LocalCurrentBranchState,
): Promise<LocalHeadState> {
  const branchState = currentBranch ?? (await getCurrentBranchState(shell));
  const commit = await getHeadCommit(shell);
  return toHeadState(branchState, commit);
}

export async function detectLocalBaseState(options: {
  shell: Shell;
  explicitBase?: string;
  currentBranch?: LocalCurrentBranchState;
}): Promise<LocalBaseState> {
  const { shell, explicitBase } = options;
  const currentBranch = options.currentBranch ?? (await getCurrentBranchState(shell));

  if (explicitBase?.trim()) {
    const trimmedBase = explicitBase.trim();
    const candidates = getExplicitBaseCandidates(trimmedBase);

    for (const candidate of candidates) {
      if (!(await refExists(shell, candidate))) continue;

      const label =
        candidate === trimmedBase
          ? "local explicit"
          : candidate.startsWith("origin/") &&
              !trimmedBase.startsWith("origin/") &&
              !trimmedBase.startsWith("refs/remotes/")
            ? "local explicit (remote)"
            : "local explicit (normalized)";

      return toBaseState(candidate, {
        kind: "explicit",
        label,
        explicit: true,
        method: toBaseDetectionMethod("explicit"),
        confidence: getBaseConfidence(candidate, { kind: "explicit" }),
      });
    }

    return toBaseState(null, {
      kind: "explicit",
      label: "local explicit",
      explicit: true,
      method: toBaseDetectionMethod("explicit"),
      confidence: getBaseConfidence(null, { kind: "explicit" }),
    });
  }

  const symbolicHead = await readTextOrEmpty(shell, [
    "git",
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  const resolvedRemoteHead = symbolicHead ? symbolicHead.replace(/^refs\/remotes\//, "") : "";
  if (resolvedRemoteHead && (await refExists(shell, resolvedRemoteHead))) {
    return toBaseState(resolvedRemoteHead, {
      kind: "remote_head_symbolic_ref",
      label: "local remote HEAD (symbolic-ref)",
      explicit: false,
      method: toBaseDetectionMethod("remote_head_symbolic_ref"),
      confidence: getBaseConfidence(resolvedRemoteHead, { kind: "remote_head_symbolic_ref" }),
    });
  }

  for (const candidate of DEFAULT_BASE_BRANCHES) {
    if (await refExists(shell, candidate)) {
      return toBaseState(candidate, {
        kind: "default_branch",
        label: `local default branch (${candidate})`,
        explicit: false,
        method: toBaseDetectionMethod("default_branch"),
        confidence: getBaseConfidence(candidate, { kind: "default_branch" }),
      });
    }

    const remoteCandidate = `origin/${candidate}`;
    if (await refExists(shell, remoteCandidate)) {
      return toBaseState(remoteCandidate, {
        kind: "default_branch",
        label: `local default branch (${remoteCandidate})`,
        explicit: false,
        method: toBaseDetectionMethod("default_branch"),
        confidence: getBaseConfidence(remoteCandidate, { kind: "default_branch" }),
      });
    }
  }

  if (currentBranch.upstream && (await refExists(shell, currentBranch.upstream))) {
    return toBaseState(currentBranch.upstream, {
      kind: "tracking_branch",
      label: "local tracking branch",
      explicit: false,
      method: toBaseDetectionMethod("tracking_branch"),
      confidence: getBaseConfidence(currentBranch.upstream, { kind: "tracking_branch" }),
    });
  }

  const remoteBranches = await listRemoteBranches(shell);
  const fallback = remoteBranches.find((remoteBranch) => {
    if (remoteBranch === "origin/HEAD") return false;
    if (!currentBranch.name) return true;
    return remoteBranch !== currentBranch.name && remoteBranch !== `origin/${currentBranch.name}`;
  });

  if (fallback) {
    return toBaseState(fallback, {
      kind: "first_remote_branch",
      label: "local first remote branch",
      explicit: false,
      method: toBaseDetectionMethod("first_remote_branch"),
      confidence: getBaseConfidence(fallback, { kind: "first_remote_branch" }),
    });
  }

  return toBaseState(null, {
    kind: "none",
    label: "local none",
    explicit: false,
    method: toBaseDetectionMethod("none"),
    confidence: getBaseConfidence(null, { kind: "none" }),
  });
}

export async function getIndexState(shell: Shell): Promise<LocalIndexState> {
  const snapshot = await getStatusSnapshot(shell);
  return {
    ref: "index",
    dirty: snapshot.indexFiles.length > 0,
    count: snapshot.indexFiles.length,
    files: snapshot.indexFiles,
    confidence: "high",
    detectionMethod: INDEX_DETECTION_METHOD,
  };
}

export async function getUntrackedFiles(shell: Shell): Promise<LocalUntrackedFilesState> {
  const raw = await runProcessText({
    shell,
    cmd: ["git", "ls-files", "--others", "--exclude-standard"],
    trim: false,
  });
  const files = [
    ...new Set(
      raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ].sort();

  return {
    ref: "worktree",
    files,
    count: files.length,
    confidence: "high",
    detectionMethod: UNTRACKED_DETECTION_METHOD,
  };
}

export async function getWorktreeState(shell: Shell): Promise<LocalWorktreeState> {
  const snapshot = await getStatusSnapshot(shell);
  return {
    ref: "worktree",
    dirty: snapshot.worktreeFiles.length > 0,
    count: snapshot.worktreeFiles.length,
    files: snapshot.worktreeFiles,
    confidence: "high",
    detectionMethod: WORKTREE_DETECTION_METHOD,
  };
}

export async function resolveLocalRepoState(options: {
  shell: Shell;
  explicitBase?: string;
}): Promise<LocalRepoState> {
  const currentBranch = await getCurrentBranchState(options.shell);
  const [base, commit, snapshot, untracked] = await Promise.all([
    detectLocalBaseState({
      shell: options.shell,
      explicitBase: options.explicitBase,
      currentBranch,
    }),
    getHeadCommit(options.shell),
    getStatusSnapshot(options.shell),
    getUntrackedFiles(options.shell),
  ]);

  const head = toHeadState(currentBranch, commit);
  const index: LocalIndexState = {
    ref: "index",
    dirty: snapshot.indexFiles.length > 0,
    count: snapshot.indexFiles.length,
    files: snapshot.indexFiles,
    confidence: "high",
    detectionMethod: INDEX_DETECTION_METHOD,
  };
  const worktree: LocalWorktreeState = {
    ref: "worktree",
    dirty: snapshot.worktreeFiles.length > 0,
    count: snapshot.worktreeFiles.length,
    files: snapshot.worktreeFiles,
    confidence: "high",
    detectionMethod: WORKTREE_DETECTION_METHOD,
  };
  const ambiguity = buildAmbiguityState({
    currentBranch,
    base,
    index,
    worktree,
    untracked,
  });
  const confidence = getLocalRepoConfidence({
    ambiguity,
    currentBranch,
    base,
    head,
    index,
    worktree,
    untracked,
  });

  return {
    currentBranch,
    head,
    base,
    confidence,
    detectionMethod: REPO_STATE_DETECTION_METHOD,
    index,
    worktree,
    untracked,
    ambiguity,
  };
}

function missingGitPathMetadata(): GitPathMetadata {
  return {
    exists: false,
    mode: null,
    objectId: null,
  };
}

async function readLocalFileDiffEntries(
  shell: Shell,
  baseRef: string | null,
): Promise<LocalFileDiffEntries> {
  const [baseToHead, headToIndex, indexToWorktree] = await Promise.all([
    baseRef
      ? readNameStatusEntries(shell, ["git", "diff", "--name-status", "-M", `${baseRef}..HEAD`, "--"])
      : Promise.resolve([]),
    readNameStatusEntries(shell, ["git", "diff", "--cached", "--name-status", "-M", "--"]),
    readNameStatusEntries(shell, ["git", "diff", "--name-status", "-M", "--"]),
  ]);

  return {
    baseToHead,
    headToIndex,
    indexToWorktree,
  };
}

async function readLocalFileMetadataLayers(options: {
  shell: Shell;
  repoState: LocalRepoState;
  resolvedPaths: LocalFilePathResolution;
}): Promise<LocalFileMetadataLayers> {
  const [base, head, index] = await Promise.all([
    options.repoState.base.ref
      ? readGitTreeMetadata(
          options.shell,
          options.repoState.base.ref,
          options.resolvedPaths.paths.base,
        )
      : Promise.resolve(missingGitPathMetadata()),
    readGitTreeMetadata(options.shell, "HEAD", options.resolvedPaths.paths.head),
    readIndexMetadata(options.shell, options.resolvedPaths.paths.index),
  ]);

  return {
    base,
    head,
    index,
  };
}

function resolveIndexToWorktreeFileEntry(options: {
  resolvedPaths: LocalFilePathResolution;
  untrackedFiles: readonly string[];
}): LocalDiffEntry | null {
  if (options.resolvedPaths.entries.indexToWorktree) {
    return options.resolvedPaths.entries.indexToWorktree;
  }

  if (!options.untrackedFiles.includes(options.resolvedPaths.paths.worktree)) {
    return null;
  }

  return {
    status: "added",
    path: options.resolvedPaths.paths.worktree,
  };
}

function createTrackedFileLayers(options: {
  repoState: LocalRepoState;
  resolvedPaths: LocalFilePathResolution;
  metadata: LocalFileMetadataLayers;
}): LocalFileTrackedLayers {
  return {
    base: toFileLayerState({
      ref: options.repoState.base.ref,
      path: options.resolvedPaths.paths.base,
      metadata: options.metadata.base,
      confidence: options.repoState.base.confidence,
      detectionMethod: BASE_FILE_DETECTION_METHOD,
    }),
    head: toFileLayerState({
      ref: "HEAD",
      path: options.resolvedPaths.paths.head,
      metadata: options.metadata.head,
      confidence: options.repoState.head.confidence,
      detectionMethod: HEAD_FILE_DETECTION_METHOD,
    }),
    index: toFileLayerState({
      ref: "index",
      path: options.resolvedPaths.paths.index,
      metadata: options.metadata.index,
      confidence: options.repoState.index.confidence,
      detectionMethod: INDEX_FILE_DETECTION_METHOD,
    }),
  };
}

function createLocalFileComparisonLayers(options: {
  repoState: LocalRepoState;
  resolvedPaths: LocalFilePathResolution;
  indexToWorktreeEntry: LocalDiffEntry | null;
}): LocalFileComparisonLayers {
  return {
    baseToHead: toFileComparison({
      fromRef: options.repoState.base.ref,
      toRef: "HEAD",
      fromPath: options.resolvedPaths.paths.base,
      toPath: options.resolvedPaths.paths.head,
      entry: options.resolvedPaths.entries.baseToHead,
      detectionMethod: BASE_TO_HEAD_FILE_DIFF_METHOD,
    }),
    headToIndex: toFileComparison({
      fromRef: "HEAD",
      toRef: "index",
      fromPath: options.resolvedPaths.paths.head,
      toPath: options.resolvedPaths.paths.index,
      entry: options.resolvedPaths.entries.headToIndex,
      detectionMethod: HEAD_TO_INDEX_FILE_DIFF_METHOD,
    }),
    indexToWorktree: toFileComparison({
      fromRef: "index",
      toRef: "worktree",
      fromPath: options.resolvedPaths.paths.index,
      toPath: options.resolvedPaths.paths.worktree,
      entry: options.indexToWorktreeEntry,
      detectionMethod: INDEX_TO_WORKTREE_FILE_DIFF_METHOD,
    }),
  };
}

function createWorktreeFileLayer(options: {
  repoState: LocalRepoState;
  resolvedPaths: LocalFilePathResolution;
  index: LocalFileLayerState;
  indexToWorktree: LocalFileComparison;
}): LocalFileLayerState {
  return {
    ref: "worktree",
    path: options.resolvedPaths.paths.worktree,
    exists: worktreeExists({
      path: options.resolvedPaths.paths.worktree,
      index: options.index,
      comparison: options.indexToWorktree,
      untrackedFiles: options.repoState.untracked.files,
    }),
    mode: null,
    objectId: null,
    confidence: options.repoState.worktree.confidence,
    detectionMethod: WORKTREE_FILE_DETECTION_METHOD,
  };
}

function createLocalFileState(options: {
  requestedPath: string;
  repoState: LocalRepoState;
  layers: LocalFileTrackedLayers & { worktree: LocalFileLayerState };
  comparisons: LocalFileComparisonLayers;
}): LocalFileState {
  return {
    requestedPath: options.requestedPath,
    resolvedPath: resolveLatestPath(options.layers),
    confidence: options.repoState.confidence,
    ambiguity: options.repoState.ambiguity,
    detectionMethod: FILE_STATE_DETECTION_METHOD,
    base: options.layers.base,
    head: options.layers.head,
    index: options.layers.index,
    worktree: options.layers.worktree,
    comparisons: options.comparisons,
  };
}

export async function resolveLocalFileState(options: {
  shell: Shell;
  requestedPath: string;
  explicitBase?: string;
}): Promise<LocalFileState> {
  const repoState = await resolveLocalRepoState({
    shell: options.shell,
    explicitBase: options.explicitBase,
  });

  const diffEntries = await readLocalFileDiffEntries(options.shell, repoState.base.ref);
  const resolvedPaths = resolveFilePaths({
    requestedPath: options.requestedPath,
    baseToHeadEntries: diffEntries.baseToHead,
    headToIndexEntries: diffEntries.headToIndex,
    indexToWorktreeEntries: diffEntries.indexToWorktree,
  });
  const metadata = await readLocalFileMetadataLayers({
    shell: options.shell,
    repoState,
    resolvedPaths,
  });
  const indexToWorktreeEntry = resolveIndexToWorktreeFileEntry({
    resolvedPaths,
    untrackedFiles: repoState.untracked.files,
  });
  const trackedLayers = createTrackedFileLayers({
    repoState,
    resolvedPaths,
    metadata,
  });
  const comparisons = createLocalFileComparisonLayers({
    repoState,
    resolvedPaths,
    indexToWorktreeEntry,
  });
  const worktree = createWorktreeFileLayer({
    repoState,
    resolvedPaths,
    index: trackedLayers.index,
    indexToWorktree: comparisons.indexToWorktree,
  });

  return createLocalFileState({
    requestedPath: options.requestedPath,
    repoState,
    layers: {
      ...trackedLayers,
      worktree,
    },
    comparisons,
  });
}
