import { runProcessText } from "../../../../shared/effect-runtime.ts";
import { getHighestAmbiguity, getHighestConfidence, getLowestConfidence } from "../shared.ts";
import {
  INDEX_DETECTION_METHOD,
  REPO_STATE_DETECTION_METHOD,
  UNTRACKED_DETECTION_METHOD,
  WORKTREE_DETECTION_METHOD,
  type LocalCurrentBranchState,
  type LocalIndexState,
  type LocalRepoAmbiguityIssue,
  type LocalRepoAmbiguityState,
  type LocalRepoState,
  type LocalUntrackedFilesState,
  type LocalWorktreeState,
  type Shell,
} from "./types.ts";
import {
  detectLocalBaseState,
  getCurrentBranchState,
  getHeadCommit,
  toHeadState,
} from "./base-detection.ts";
import { getStatusSnapshot } from "./status.ts";

function getLocalRepoConfidence(state: {
  ambiguity: LocalRepoAmbiguityState;
  currentBranch: LocalCurrentBranchState;
  base: LocalRepoState["base"];
  head: LocalRepoState["head"];
  index: LocalIndexState;
  worktree: LocalWorktreeState;
  untracked: LocalUntrackedFilesState;
}): LocalRepoState["confidence"] {
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

function buildAmbiguityState(state: {
  currentBranch: LocalCurrentBranchState;
  base: LocalRepoState["base"];
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
    level: getHighestAmbiguity(issues.map((issue) => issue.level)),
    issues,
  };
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
