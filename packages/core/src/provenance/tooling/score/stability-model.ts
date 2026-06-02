import { z } from "zod";
import { ProvRepoStateDataSchema, type LocalRepoState } from "../state/internal.ts";
import { aggregateWindow, collectStatusPaths, filterHistoryByWindow, isPathWithinAnchor } from "./aggregation.ts";
import { DAY_MS, DEFAULT_STABILITY_BASELINE_WINDOW_DAYS, DEFAULT_STABILITY_RECENT_WINDOW_DAYS } from "./constants.ts";
import { buildHistorySummary } from "./history-summary.ts";
import { buildAssessment } from "./stability-scores.ts";
import { ProvStabilityReportDataSchema } from "./schemas.ts";
import type { LoadedHistory, StabilityPendingPaths, StabilityWindowAggregates, StabilityWindows } from "./types.ts";

export function resolveStabilityWindows(args: {
  recent_window_days?: number;
  baseline_window_days?: number;
}): StabilityWindows {
  const recentWindowDays = Math.min(
    args.recent_window_days ?? DEFAULT_STABILITY_RECENT_WINDOW_DAYS,
    args.baseline_window_days ?? DEFAULT_STABILITY_BASELINE_WINDOW_DAYS,
  );
  const baselineWindowDays = Math.max(
    args.recent_window_days ?? DEFAULT_STABILITY_RECENT_WINDOW_DAYS,
    args.baseline_window_days ?? DEFAULT_STABILITY_BASELINE_WINDOW_DAYS,
  );
  return { recentWindowDays, baselineWindowDays };
}

export function buildStabilityWindowAggregates(options: {
  history: LoadedHistory;
  resolvedPath: string;
  windows: StabilityWindows;
}): StabilityWindowAggregates {
  const anchorMs = options.history.headAuthoredAtMs ?? Date.now();
  const recentSince = new Date(anchorMs - options.windows.recentWindowDays * DAY_MS).toISOString();
  const baselineSince = new Date(
    anchorMs - options.windows.baselineWindowDays * DAY_MS,
  ).toISOString();

  return {
    historySummary: buildHistorySummary(options.history),
    recentSince,
    baselineSince,
    recentAggregate: aggregateWindow({
      commits: filterHistoryByWindow(options.history.commits, Date.parse(recentSince)),
      anchorPath: options.resolvedPath,
      groupBy: "file",
      directoryDepth: 1,
    }),
    baselineAggregate: aggregateWindow({
      commits: filterHistoryByWindow(options.history.commits, Date.parse(baselineSince)),
      anchorPath: options.resolvedPath,
      groupBy: "file",
      directoryDepth: 1,
    }),
  };
}

export function collectStabilityPendingPaths(
  repoState: LocalRepoState,
  resolvedPath: string,
): StabilityPendingPaths {
  const pendingPaths = {
    staged: new Set<string>(),
    unstaged: new Set<string>(),
    untracked: new Set<string>(),
  };
  for (const entry of repoState.index.files) {
    for (const matched of collectStatusPaths(entry, resolvedPath)) {
      pendingPaths.staged.add(matched);
    }
  }
  for (const entry of repoState.worktree.files) {
    for (const matched of collectStatusPaths(entry, resolvedPath)) {
      pendingPaths.unstaged.add(matched);
    }
  }
  for (const entry of repoState.untracked.files) {
    const normalized = entry.replace(/\\/g, "/");
    if (isPathWithinAnchor(normalized, resolvedPath)) {
      pendingPaths.untracked.add(normalized);
    }
  }

  return {
    pendingPaths,
    allPending: new Set<string>([
      ...pendingPaths.staged,
      ...pendingPaths.unstaged,
      ...pendingPaths.untracked,
    ]),
  };
}

export function buildStabilityReportData(options: {
  requestedPath: string;
  resolvedPath: string;
  repo: z.infer<typeof ProvRepoStateDataSchema>;
  history: LoadedHistory;
  windows: StabilityWindows;
  aggregates: StabilityWindowAggregates;
  pending: StabilityPendingPaths;
  scores: z.infer<typeof ProvStabilityReportDataSchema>["scores"];
}): z.infer<typeof ProvStabilityReportDataSchema> {
  return {
    anchor: {
      requestedPath: options.requestedPath,
      resolvedPath: options.resolvedPath,
    },
    repo: options.repo,
    history: options.aggregates.historySummary,
    windows: {
      recent: {
        days: options.windows.recentWindowDays,
        since: options.aggregates.recentSince,
        until: options.history.headAuthoredAt ?? options.aggregates.recentSince,
        commits: options.aggregates.recentAggregate.commits,
      },
      baseline: {
        days: options.windows.baselineWindowDays,
        since: options.aggregates.baselineSince,
        until: options.history.headAuthoredAt ?? options.aggregates.baselineSince,
        commits: options.aggregates.baselineAggregate.commits,
        touchedPaths: options.aggregates.baselineAggregate.rawTouchedPaths,
        uniqueAuthors: options.aggregates.baselineAggregate.uniqueAuthors,
        additions: options.aggregates.baselineAggregate.additions,
        deletions: options.aggregates.baselineAggregate.deletions,
        churn: options.aggregates.baselineAggregate.churn,
        lastTouchedAt: options.aggregates.baselineAggregate.lastTouchedAt,
      },
    },
    pending: {
      staged: options.pending.pendingPaths.staged.size,
      unstaged: options.pending.pendingPaths.unstaged.size,
      untracked: options.pending.pendingPaths.untracked.size,
      totalPaths: options.pending.allPending.size,
    },
    scores: options.scores,
    assessment: buildAssessment(options.scores),
  };
}
