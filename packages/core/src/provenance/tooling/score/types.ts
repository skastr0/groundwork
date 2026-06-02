import type { ProvenanceBounds } from "../contracts.ts";
import type { HistorySummary } from "./schemas.ts";

export type HistoryChange = {
  path: string;
  additions: number;
  deletions: number;
  churn: number;
};

export type HistoryCommit = {
  commit: string;
  authoredAt: string;
  authoredAtMs: number;
  authorName: string;
  authorEmail: string;
  summary: string;
  changes: HistoryChange[];
};

export type LoadedHistory = {
  headCommit: string | null;
  headAuthoredAt: string | null;
  headAuthoredAtMs: number | null;
  oldestSince: string | null;
  totalCommits: number;
  commits: HistoryCommit[];
  bounds: ProvenanceBounds;
  detectionMethod: string;
};

export type HistoryLoadOptions = {
  requestedMaxCommits: number | undefined;
  boundedMaxCommits: number;
  largestWindow: number;
  pathSpec: string;
};

export type HistoryHeadAnchor =
  | {
      status: "available";
      headCommit: string;
      headAuthoredAt: string;
      headAuthoredAtMs: number;
    }
  | {
      status: "unavailable";
    };

export type RawHistoryData = {
  countRaw: string;
  logRaw: string;
};

export type MutablePathStats = {
  path: string;
  commitCount: number;
  additions: number;
  deletions: number;
  churn: number;
  lastTouchedAt: string | null;
  authors: Set<string>;
  authorMetadata: Map<string, { authorName: string; authorEmail: string }>;
  authorCommitCounts: Map<string, number>;
};

export type AuthorStats = {
  authorName: string;
  authorEmail: string;
  commits: number;
  uniquePaths: Set<string>;
  additions: number;
  deletions: number;
  churn: number;
  lastTouchedAt: string | null;
};

export type WindowAggregate = {
  commits: number;
  touchedPaths: number;
  additions: number;
  deletions: number;
  churn: number;
  uniqueAuthors: number;
  lastTouchedAt: string | null;
  pathStats: MutablePathStats[];
  authorStats: AuthorStats[];
  rawTouchedPaths: number;
};

export type MutableWindowTotals = {
  additions: number;
  deletions: number;
  lastTouchedAt: string | null;
};

export type PerCommitPathMetrics = {
  additions: number;
  deletions: number;
  churn: number;
};

export type StabilityWindows = {
  recentWindowDays: number;
  baselineWindowDays: number;
};

export type StabilityWindowAggregates = {
  historySummary: HistorySummary;
  recentSince: string;
  baselineSince: string;
  recentAggregate: WindowAggregate;
  baselineAggregate: WindowAggregate;
};

export type StabilityPendingPaths = {
  pendingPaths: {
    staged: Set<string>;
    unstaged: Set<string>;
    untracked: Set<string>;
  };
  allPending: Set<string>;
};

export type HotspotsToolInput = {
  path?: string;
  windows?: number[];
  group_by?: "file" | "directory";
  directory_depth?: number;
  limit?: number;
  max_commits?: number;
  mode?: "local" | "remote" | "hybrid";
};

export type AuthorityToolInput = {
  path?: string;
  window_days?: number;
  limit?: number;
  max_commits?: number;
  mode?: "local" | "remote" | "hybrid";
};

export type StabilityReportToolInput = {
  path?: string;
  recent_window_days?: number;
  baseline_window_days?: number;
  limit?: number;
  max_commits?: number;
  mode?: "local" | "remote" | "hybrid";
};
