import path from "node:path";
import type { LocalRepoFileStatus } from "../state/internal.ts";
import type { AuthorityAuthor } from "./schemas.ts";
import type { AuthorStats, HistoryCommit, MutablePathStats, MutableWindowTotals, PerCommitPathMetrics, WindowAggregate } from "./types.ts";

export function isPathWithinAnchor(targetPath: string, anchorPath: string): boolean {
  if (anchorPath === ".") {
    return true;
  }

  return targetPath === anchorPath || targetPath.startsWith(`${anchorPath}/`);
}

export function collectStatusPaths(entry: LocalRepoFileStatus, anchorPath: string): string[] {
  const candidates = [entry.path, entry.newPath].filter((value): value is string => Boolean(value));
  return [...new Set(candidates.map((value) => value.replace(/\\/g, "/")))].filter((value) =>
    isPathWithinAnchor(value, anchorPath),
  );
}

function getDirectoryGroupKey(filePath: string, anchorPath: string, depth: number): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  const fileDirectory = path.posix.dirname(normalizedPath);
  const baseAnchor = normalizedPath === anchorPath ? path.posix.dirname(anchorPath) : anchorPath;
  const relativeBase = baseAnchor === "." ? "" : baseAnchor;
  const relativeDirectory = relativeBase
    ? path.posix.relative(relativeBase, fileDirectory)
    : fileDirectory;

  const segments = relativeDirectory === "." ? [] : relativeDirectory.split("/").filter(Boolean);
  if (segments.length === 0) {
    return relativeBase || ".";
  }

  const prefix = relativeBase ? [relativeBase] : [];
  return [...prefix, ...segments.slice(0, depth)].join("/");
}

export function filterHistoryByWindow(
  commits: readonly HistoryCommit[],
  sinceTimestamp: number,
): HistoryCommit[] {
  return commits.filter((commit) => commit.authoredAtMs >= sinceTimestamp);
}

function getAuthorKey(commit: HistoryCommit): string {
  return `${commit.authorName}<${commit.authorEmail}>`;
}

function createAuthorStats(commit: HistoryCommit): AuthorStats {
  return {
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    commits: 0,
    uniquePaths: new Set<string>(),
    additions: 0,
    deletions: 0,
    churn: 0,
    lastTouchedAt: null,
  };
}

function createPathStats(pathKey: string): MutablePathStats {
  return {
    path: pathKey,
    commitCount: 0,
    additions: 0,
    deletions: 0,
    churn: 0,
    lastTouchedAt: null,
    authors: new Set<string>(),
    authorMetadata: new Map<string, { authorName: string; authorEmail: string }>(),
    authorCommitCounts: new Map<string, number>(),
  };
}

function updateLatestTimestamp(current: string | null, candidate: string): string {
  return !current || candidate > current ? candidate : current;
}

function groupCommitChangesByPath(options: {
  commit: HistoryCommit;
  anchorPath: string;
  groupBy: "file" | "directory";
  directoryDepth: number;
  rawTouchedPaths: Set<string>;
  totals: MutableWindowTotals;
}): {
  grouped: Map<string, PerCommitPathMetrics>;
  rawPaths: Set<string>;
} {
  const grouped = new Map<string, PerCommitPathMetrics>();
  const rawPaths = new Set<string>();

  for (const change of options.commit.changes) {
    options.rawTouchedPaths.add(change.path);
    rawPaths.add(change.path);
    options.totals.additions += change.additions;
    options.totals.deletions += change.deletions;

    const key =
      options.groupBy === "file"
        ? change.path
        : getDirectoryGroupKey(change.path, options.anchorPath, options.directoryDepth);
    const existing = grouped.get(key) ?? { additions: 0, deletions: 0, churn: 0 };
    existing.additions += change.additions;
    existing.deletions += change.deletions;
    existing.churn += change.churn;
    grouped.set(key, existing);
  }

  return { grouped, rawPaths };
}

function accumulateAuthorStats(options: {
  commit: HistoryCommit;
  authorKey: string;
  rawPaths: Set<string>;
  authorStats: Map<string, AuthorStats>;
}): void {
  const author = options.authorStats.get(options.authorKey) ?? createAuthorStats(options.commit);
  author.commits += 1;

  for (const rawPath of options.rawPaths) {
    author.uniquePaths.add(rawPath);
  }

  for (const change of options.commit.changes) {
    author.additions += change.additions;
    author.deletions += change.deletions;
    author.churn += change.churn;
  }

  author.lastTouchedAt = updateLatestTimestamp(author.lastTouchedAt, options.commit.authoredAt);
  options.authorStats.set(options.authorKey, author);
}

function accumulatePathStats(options: {
  commit: HistoryCommit;
  authorKey: string;
  grouped: Map<string, PerCommitPathMetrics>;
  pathStats: Map<string, MutablePathStats>;
}): void {
  for (const [key, metrics] of options.grouped.entries()) {
    const stats = options.pathStats.get(key) ?? createPathStats(key);
    stats.commitCount += 1;
    stats.additions += metrics.additions;
    stats.deletions += metrics.deletions;
    stats.churn += metrics.churn;
    stats.authors.add(options.authorKey);
    stats.authorMetadata.set(options.authorKey, {
      authorName: options.commit.authorName,
      authorEmail: options.commit.authorEmail,
    });
    stats.authorCommitCounts.set(
      options.authorKey,
      (stats.authorCommitCounts.get(options.authorKey) ?? 0) + 1,
    );
    stats.lastTouchedAt = updateLatestTimestamp(stats.lastTouchedAt, options.commit.authoredAt);
    options.pathStats.set(key, stats);
  }
}

export function aggregateWindow(options: {
  commits: readonly HistoryCommit[];
  anchorPath: string;
  groupBy: "file" | "directory";
  directoryDepth: number;
}): WindowAggregate {
  const pathStats = new Map<string, MutablePathStats>();
  const authorStats = new Map<string, AuthorStats>();
  const uniqueAuthors = new Set<string>();
  const rawTouchedPaths = new Set<string>();
  const totals: MutableWindowTotals = {
    additions: 0,
    deletions: 0,
    lastTouchedAt: null,
  };

  for (const commit of options.commits) {
    const authorKey = getAuthorKey(commit);
    uniqueAuthors.add(authorKey);
    if (commit.authoredAt) {
      totals.lastTouchedAt = updateLatestTimestamp(totals.lastTouchedAt, commit.authoredAt);
    }

    const perCommit = groupCommitChangesByPath({
      commit,
      anchorPath: options.anchorPath,
      groupBy: options.groupBy,
      directoryDepth: options.directoryDepth,
      rawTouchedPaths,
      totals,
    });

    accumulateAuthorStats({
      commit,
      authorKey,
      rawPaths: perCommit.rawPaths,
      authorStats,
    });
    accumulatePathStats({
      commit,
      authorKey,
      grouped: perCommit.grouped,
      pathStats,
    });
  }

  return {
    commits: options.commits.length,
    touchedPaths: pathStats.size,
    additions: totals.additions,
    deletions: totals.deletions,
    churn: totals.additions + totals.deletions,
    uniqueAuthors: uniqueAuthors.size,
    lastTouchedAt: totals.lastTouchedAt,
    pathStats: [...pathStats.values()],
    authorStats: [...authorStats.values()],
    rawTouchedPaths: rawTouchedPaths.size,
  };
}

export function compareHotspotByActivity(left: MutablePathStats, right: MutablePathStats): number {
  if (right.commitCount !== left.commitCount) {
    return right.commitCount - left.commitCount;
  }
  if (right.churn !== left.churn) {
    return right.churn - left.churn;
  }
  return left.path.localeCompare(right.path);
}

export function compareHotspotByChurn(left: MutablePathStats, right: MutablePathStats): number {
  if (right.churn !== left.churn) {
    return right.churn - left.churn;
  }
  if (right.commitCount !== left.commitCount) {
    return right.commitCount - left.commitCount;
  }
  return left.path.localeCompare(right.path);
}

export function compareAuthors(left: AuthorityAuthor, right: AuthorityAuthor): number {
  if (right.score.value !== left.score.value) {
    return right.score.value - left.score.value;
  }
  if (right.commits !== left.commits) {
    return right.commits - left.commits;
  }
  return `${left.authorName}<${left.authorEmail}>`.localeCompare(
    `${right.authorName}<${right.authorEmail}>`,
  );
}
