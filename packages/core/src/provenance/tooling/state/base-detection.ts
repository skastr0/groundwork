import { runProcessText } from "../../../shared/effect-runtime.ts";
import type { ProvenanceConfidence } from "../contracts.ts";
import {
  BRANCH_DETECTION_METHOD,
  HEAD_DETECTION_METHOD,
  type LocalBaseDetection,
  type LocalBaseDetectionKind,
  type LocalBaseState,
  type LocalCurrentBranchState,
  type LocalHeadState,
  type Shell,
} from "./types.ts";
import { readTextOrEmpty, refExists } from "./git-helpers.ts";

const DEFAULT_BASE_BRANCHES = ["main", "master", "develop", "development"] as const;

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

export function extractBranchNameFromRef(ref: string | null): string | null {
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

function makeBaseState(options: {
  ref: string | null;
  kind: LocalBaseDetectionKind;
  label: string;
  explicit: boolean;
}): LocalBaseState {
  const detection = { kind: options.kind };

  return toBaseState(options.ref, {
    kind: options.kind,
    label: options.label,
    explicit: options.explicit,
    method: toBaseDetectionMethod(options.kind),
    confidence: getBaseConfidence(options.ref, detection),
  });
}

function getExplicitBaseLabel(candidate: string, trimmedBase: string): string {
  if (candidate === trimmedBase) {
    return "local explicit";
  }

  if (
    candidate.startsWith("origin/") &&
    !trimmedBase.startsWith("origin/") &&
    !trimmedBase.startsWith("refs/remotes/")
  ) {
    return "local explicit (remote)";
  }

  return "local explicit (normalized)";
}

async function resolveExplicitBaseState(options: {
  shell: Shell;
  explicitBase?: string;
}): Promise<LocalBaseState | null> {
  const trimmedBase = options.explicitBase?.trim();
  if (!trimmedBase) {
    return null;
  }

  for (const candidate of getExplicitBaseCandidates(trimmedBase)) {
    if (!(await refExists(options.shell, candidate))) continue;

    return makeBaseState({
      ref: candidate,
      kind: "explicit",
      label: getExplicitBaseLabel(candidate, trimmedBase),
      explicit: true,
    });
  }

  return makeBaseState({
    ref: null,
    kind: "explicit",
    label: "local explicit",
    explicit: true,
  });
}

async function resolveRemoteHeadBaseState(shell: Shell): Promise<LocalBaseState | null> {
  const symbolicHead = await readTextOrEmpty(shell, [
    "git",
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
  ]);
  const resolvedRemoteHead = symbolicHead ? symbolicHead.replace(/^refs\/remotes\//, "") : "";
  if (!resolvedRemoteHead || !(await refExists(shell, resolvedRemoteHead))) {
    return null;
  }

  return makeBaseState({
    ref: resolvedRemoteHead,
    kind: "remote_head_symbolic_ref",
    label: "local remote HEAD (symbolic-ref)",
    explicit: false,
  });
}

async function resolveDefaultBranchBaseState(shell: Shell): Promise<LocalBaseState | null> {
  for (const candidate of DEFAULT_BASE_BRANCHES) {
    if (await refExists(shell, candidate)) {
      return makeBaseState({
        ref: candidate,
        kind: "default_branch",
        label: `local default branch (${candidate})`,
        explicit: false,
      });
    }

    const remoteCandidate = `origin/${candidate}`;
    if (await refExists(shell, remoteCandidate)) {
      return makeBaseState({
        ref: remoteCandidate,
        kind: "default_branch",
        label: `local default branch (${remoteCandidate})`,
        explicit: false,
      });
    }
  }

  return null;
}

async function resolveTrackingBranchBaseState(options: {
  shell: Shell;
  currentBranch: LocalCurrentBranchState;
}): Promise<LocalBaseState | null> {
  const upstream = options.currentBranch.upstream;
  if (!upstream || !(await refExists(options.shell, upstream))) {
    return null;
  }

  return makeBaseState({
    ref: upstream,
    kind: "tracking_branch",
    label: "local tracking branch",
    explicit: false,
  });
}

async function resolveFirstRemoteBranchBaseState(options: {
  shell: Shell;
  currentBranch: LocalCurrentBranchState;
}): Promise<LocalBaseState | null> {
  const remoteBranches = await listRemoteBranches(options.shell);
  const fallback = remoteBranches.find((remoteBranch) => {
    if (remoteBranch === "origin/HEAD") return false;
    if (!options.currentBranch.name) return true;
    return (
      remoteBranch !== options.currentBranch.name &&
      remoteBranch !== `origin/${options.currentBranch.name}`
    );
  });

  if (!fallback) {
    return null;
  }

  return makeBaseState({
    ref: fallback,
    kind: "first_remote_branch",
    label: "local first remote branch",
    explicit: false,
  });
}

function resolveNoBaseState(): LocalBaseState {
  return makeBaseState({
    ref: null,
    kind: "none",
    label: "local none",
    explicit: false,
  });
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

export async function getHeadCommit(shell: Shell): Promise<string | null> {
  const commit = await readTextOrEmpty(shell, ["git", "rev-parse", "--verify", "HEAD"]);
  return commit || null;
}

export function toHeadState(
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
  const { shell } = options;
  const currentBranch = options.currentBranch ?? (await getCurrentBranchState(shell));
  const explicitBase = await resolveExplicitBaseState({
    shell,
    explicitBase: options.explicitBase,
  });
  if (explicitBase) return explicitBase;

  const remoteHeadBase = await resolveRemoteHeadBaseState(shell);
  if (remoteHeadBase) return remoteHeadBase;

  const defaultBranchBase = await resolveDefaultBranchBaseState(shell);
  if (defaultBranchBase) return defaultBranchBase;

  const trackingBranchBase = await resolveTrackingBranchBaseState({ shell, currentBranch });
  if (trackingBranchBase) return trackingBranchBase;

  const firstRemoteBranchBase = await resolveFirstRemoteBranchBaseState({
    shell,
    currentBranch,
  });
  if (firstRemoteBranchBase) return firstRemoteBranchBase;

  return resolveNoBaseState();
}
