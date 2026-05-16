import path from "node:path";
import type { LocalRepoFileStatus } from "../state/index.ts";
import { toNearbyFileSummary } from "./change-summaries.ts";
import type {
  TreeAreaSummary,
  TreeCheckoutSummary,
  TreeFileSummary,
  TreeStatusBreakdown,
} from "./schemas.ts";
import { toNormalizedPath } from "./shared.ts";
import {
  detectAreaKind,
  isPathWithinAnchor,
} from "./tree-anchor.ts";
import {
  AREA_SAMPLE_PATH_LIMIT,
  comparePaths,
  STATUS_PRIORITY,
  type MatchedSection,
  type MutableAreaSummary,
} from "./tree-types.ts";

function createStatusBreakdown(): TreeStatusBreakdown {
  return {
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
    copied: 0,
    unknown: 0,
  };
}

function createCheckoutSummary(): TreeCheckoutSummary {
  return {
    staged: 0,
    unstaged: 0,
    untracked: 0,
  };
}

export function mergeTreeFiles(matches: readonly MatchedSection[]): TreeFileSummary[] {
  const merged = new Map<string, TreeFileSummary>();

  for (const match of matches) {
    const next = {
      ...toNearbyFileSummary({
        key: "artifact",
        fromRef: null,
        toRef: null,
        section: match.section,
      }),
      matchedPath: match.matchedPath,
    } satisfies TreeFileSummary;
    const key = next.matchedPath;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, next);
      continue;
    }

    const nextPriority = STATUS_PRIORITY[next.status];
    const existingPriority = STATUS_PRIORITY[existing.status];
    merged.set(key, {
      key: existing.key,
      fromRef: existing.fromRef,
      toRef: existing.toRef,
      path: nextPriority >= existingPriority ? next.path : existing.path,
      oldPath: existing.oldPath ?? next.oldPath,
      status: nextPriority >= existingPriority ? next.status : existing.status,
      additions: existing.additions + next.additions,
      deletions: existing.deletions + next.deletions,
      hunkCount: existing.hunkCount + next.hunkCount,
      matchedPath: existing.matchedPath,
    });
  }

  return [...merged.values()].sort((left, right) => {
    const leftChurn = left.additions + left.deletions;
    const rightChurn = right.additions + right.deletions;
    if (rightChurn !== leftChurn) {
      return rightChurn - leftChurn;
    }

    const leftPriority = STATUS_PRIORITY[left.status];
    const rightPriority = STATUS_PRIORITY[right.status];
    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }

    return left.matchedPath.localeCompare(right.matchedPath);
  });
}

function deriveAreaPath(filePath: string, anchorPath: string, maxDepth: number): string {
  const normalized = toNormalizedPath(filePath);
  const relative = anchorPath === "." ? normalized : path.posix.relative(anchorPath, normalized);
  const relativeDir = path.posix.dirname(relative);
  if (relativeDir === ".") {
    return anchorPath;
  }

  const segments = relativeDir.split("/").filter(Boolean);
  const boundedSegments = segments.slice(0, Math.min(maxDepth, segments.length));
  if (anchorPath === ".") {
    return boundedSegments.join("/");
  }

  return toNormalizedPath(path.posix.join(anchorPath, ...boundedSegments));
}

function areaDepth(areaPath: string, anchorPath: string): number {
  if (areaPath === anchorPath) {
    return 0;
  }

  const relative = anchorPath === "." ? areaPath : path.posix.relative(anchorPath, areaPath);
  return relative.split("/").filter(Boolean).length;
}

function areaSort(left: TreeAreaSummary, right: TreeAreaSummary): number {
  if (right.changedFiles !== left.changedFiles) {
    return right.changedFiles - left.changedFiles;
  }

  const leftChurn = left.additions + left.deletions;
  const rightChurn = right.additions + right.deletions;
  if (rightChurn !== leftChurn) {
    return rightChurn - leftChurn;
  }

  const leftCheckout = left.checkout.staged + left.checkout.unstaged + left.checkout.untracked;
  const rightCheckout = right.checkout.staged + right.checkout.unstaged + right.checkout.untracked;
  if (rightCheckout !== leftCheckout) {
    return rightCheckout - leftCheckout;
  }

  return left.path.localeCompare(right.path);
}

async function getOrCreateArea(options: {
  areaMap: Map<string, MutableAreaSummary>;
  rootDir: string;
  anchorPath: string;
  areaPath: string;
}): Promise<MutableAreaSummary> {
  const existing = options.areaMap.get(options.areaPath);
  if (existing) {
    return existing;
  }

  const next: MutableAreaSummary = {
    path: options.areaPath,
    depth: areaDepth(options.areaPath, options.anchorPath),
    kind: await detectAreaKind(options.rootDir, options.areaPath),
    changedFiles: 0,
    additions: 0,
    deletions: 0,
    statuses: createStatusBreakdown(),
    checkout: createCheckoutSummary(),
    samplePaths: new Set<string>(),
  };
  options.areaMap.set(options.areaPath, next);
  return next;
}

async function applyFileSummaries(options: {
  areaMap: Map<string, MutableAreaSummary>;
  rootDir: string;
  anchorPath: string;
  maxDepth: number;
  files: readonly TreeFileSummary[];
}): Promise<void> {
  for (const file of options.files) {
    const areaPath = deriveAreaPath(file.matchedPath, options.anchorPath, options.maxDepth);
    const area = await getOrCreateArea({
      areaMap: options.areaMap,
      rootDir: options.rootDir,
      anchorPath: options.anchorPath,
      areaPath,
    });
    area.changedFiles += 1;
    area.additions += file.additions;
    area.deletions += file.deletions;
    area.statuses[file.status] += 1;
    area.samplePaths.add(file.matchedPath);
  }
}

async function applyCheckoutBucket(options: {
  areaMap: Map<string, MutableAreaSummary>;
  anchorPath: string;
  maxDepth: number;
  bucket: keyof TreeCheckoutSummary;
  filePaths: readonly string[];
}): Promise<void> {
  for (const filePath of options.filePaths) {
    if (!isPathWithinAnchor(filePath, options.anchorPath)) {
      continue;
    }

    const areaPath = deriveAreaPath(filePath, options.anchorPath, options.maxDepth);
    const area = options.areaMap.get(areaPath);
    if (!area) {
      continue;
    }

    area.checkout[options.bucket] += 1;
  }
}

export async function buildAreaSummaries(options: {
  rootDir: string;
  anchorPath: string;
  maxDepth: number;
  files: readonly TreeFileSummary[];
  indexFiles: readonly LocalRepoFileStatus[];
  worktreeFiles: readonly LocalRepoFileStatus[];
  untrackedFiles: readonly string[];
}): Promise<TreeAreaSummary[]> {
  const areaMap = new Map<string, MutableAreaSummary>();
  await applyFileSummaries({
    areaMap,
    rootDir: options.rootDir,
    anchorPath: options.anchorPath,
    maxDepth: options.maxDepth,
    files: options.files,
  });

  await Promise.all([
    applyCheckoutBucket({
      areaMap,
      anchorPath: options.anchorPath,
      maxDepth: options.maxDepth,
      bucket: "staged",
      filePaths: options.indexFiles.map((file) => toNormalizedPath(file.newPath ?? file.path)),
    }),
    applyCheckoutBucket({
      areaMap,
      anchorPath: options.anchorPath,
      maxDepth: options.maxDepth,
      bucket: "unstaged",
      filePaths: options.worktreeFiles.map((file) => toNormalizedPath(file.newPath ?? file.path)),
    }),
    applyCheckoutBucket({
      areaMap,
      anchorPath: options.anchorPath,
      maxDepth: options.maxDepth,
      bucket: "untracked",
      filePaths: options.untrackedFiles.map((filePath) => toNormalizedPath(filePath)),
    }),
  ]);

  return [...areaMap.values()]
    .map((area) => ({
      path: area.path,
      kind: area.kind,
      depth: area.depth,
      changedFiles: area.changedFiles,
      additions: area.additions,
      deletions: area.deletions,
      statuses: area.statuses,
      checkout: area.checkout,
      samplePaths: [...area.samplePaths].sort(comparePaths).slice(0, AREA_SAMPLE_PATH_LIMIT),
    }))
    .sort(areaSort);
}

export function summarizeCheckout(options: {
  anchorPath: string;
  indexFiles: readonly LocalRepoFileStatus[];
  worktreeFiles: readonly LocalRepoFileStatus[];
  untrackedFiles: readonly string[];
}): TreeCheckoutSummary {
  return {
    staged: options.indexFiles.filter((file) =>
      isPathWithinAnchor(toNormalizedPath(file.newPath ?? file.path), options.anchorPath),
    ).length,
    unstaged: options.worktreeFiles.filter((file) =>
      isPathWithinAnchor(toNormalizedPath(file.newPath ?? file.path), options.anchorPath),
    ).length,
    untracked: options.untrackedFiles.filter((filePath) =>
      isPathWithinAnchor(toNormalizedPath(filePath), options.anchorPath),
    ).length,
  };
}
