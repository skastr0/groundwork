import {
  BASE_FILE_DETECTION_METHOD,
  BASE_TO_HEAD_FILE_DIFF_METHOD,
  FILE_STATE_DETECTION_METHOD,
  HEAD_FILE_DETECTION_METHOD,
  HEAD_TO_INDEX_FILE_DIFF_METHOD,
  INDEX_FILE_DETECTION_METHOD,
  INDEX_TO_WORKTREE_FILE_DIFF_METHOD,
  WORKTREE_FILE_DETECTION_METHOD,
  type LocalFileComparison,
  type LocalFileComparisonStatus,
  type LocalFileLayerState,
  type LocalFileState,
  type LocalRepoState,
  type Shell,
} from "./types.ts";
import { readTextOrEmpty } from "./git-helpers.ts";
import {
  type LocalDiffEntry,
  readNameStatusEntries,
} from "./status.ts";
import { resolveLocalRepoState } from "./repo-state.ts";

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

type LocalFilePathTransition = {
  key: keyof LocalFilePathResolution["entries"];
  from: LocalFilePathKey;
  to: LocalFilePathKey;
  entries: readonly LocalDiffEntry[];
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
  const resolution = createInitialFilePathResolution(options.requestedPath);
  const transitions = createFilePathTransitions(options);

  for (let pass = 0; pass < 4; pass += 1) {
    const changed = applyFilePathResolutionPass(resolution, transitions);
    if (!changed) {
      break;
    }
  }

  return resolution;
}

function createInitialFilePathResolution(requestedPath: string): LocalFilePathResolution {
  return {
    paths: {
      base: requestedPath,
      head: requestedPath,
      index: requestedPath,
      worktree: requestedPath,
    },
    entries: {
      baseToHead: null,
      headToIndex: null,
      indexToWorktree: null,
    },
  };
}

function createFilePathTransitions(options: {
  baseToHeadEntries: readonly LocalDiffEntry[];
  headToIndexEntries: readonly LocalDiffEntry[];
  indexToWorktreeEntries: readonly LocalDiffEntry[];
}): LocalFilePathTransition[] {
  return [
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
}

function applyFilePathResolutionPass(
  resolution: LocalFilePathResolution,
  transitions: readonly LocalFilePathTransition[],
): boolean {
  let changed = false;

  for (const transition of transitions) {
    if (applyFilePathTransition(resolution, transition)) {
      changed = true;
    }
  }

  return changed;
}

function applyFilePathTransition(
  resolution: LocalFilePathResolution,
  transition: LocalFilePathTransition,
): boolean {
  const matchedEntry = findMatchingDiffEntry(transition.entries, [
    resolution.paths[transition.from],
    resolution.paths[transition.to],
  ]);
  if (!matchedEntry) {
    return false;
  }

  resolution.entries[transition.key] = matchedEntry;
  const { fromPath, toPath } = getDiffEntryPaths(matchedEntry);
  const fromChanged = updateResolvedPath(resolution.paths, transition.from, fromPath);
  const toChanged = updateResolvedPath(resolution.paths, transition.to, toPath);
  return fromChanged || toChanged;
}

function updateResolvedPath(
  paths: LocalFilePathChain,
  key: LocalFilePathKey,
  nextPath: string,
): boolean {
  if (paths[key] === nextPath) {
    return false;
  }

  paths[key] = nextPath;
  return true;
}

function missingGitPathMetadata(): GitPathMetadata {
  return {
    exists: false,
    mode: null,
    objectId: null,
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

function toFileLayerState(options: {
  ref: string | null;
  path: string;
  metadata: GitPathMetadata;
  confidence: LocalFileLayerState["confidence"];
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

async function readLocalFileDiffEntries(
  shell: Shell,
  baseRef: string | null,
): Promise<LocalFileDiffEntries> {
  const [baseToHead, headToIndex, indexToWorktree] = await Promise.all([
    baseRef
      ? readNameStatusEntries(shell, [
          "git",
          "diff",
          "--name-status",
          "-M",
          `${baseRef}..HEAD`,
          "--",
        ])
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
