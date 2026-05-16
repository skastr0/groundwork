import { z } from "zod";
import { createScore, describeOwnershipClarity, describePressure, round, shareFactor, toPercent } from "./score-primitives.ts";
import { ProvStabilityReportDataSchema, type ExplainableScore, type StabilityAssessment } from "./schemas.ts";
import type { AuthorStats, StabilityWindows, WindowAggregate } from "./types.ts";

export function buildAssessment(
  scores: z.infer<typeof ProvStabilityReportDataSchema>["scores"],
): StabilityAssessment {
  const reasons: string[] = [];

  if (scores.pendingChangePressure.value >= 70) {
    reasons.push("uncommitted changes currently cover most recently touched paths");
  }
  if (scores.recentChangePressure.value >= 70) {
    reasons.push("recent change pressure is concentrated in the short window");
  }
  if (scores.ownershipClarity.value >= 70) {
    reasons.push("one recent steward dominates the observed history");
  }
  if (scores.pendingChangePressure.value >= 70 || scores.recentChangePressure.value >= 70) {
    return {
      label: "volatile",
      reasons: reasons.length > 0 ? reasons : ["recent change pressure is high"],
    };
  }

  if (scores.stability.value >= 70) {
    return {
      label: "steady",
      reasons: reasons.length > 0 ? reasons : ["current signals are calm and well explained"],
    };
  }

  return {
    label: "watch",
    reasons:
      reasons.length > 0 ? reasons : ["signals are mixed across recency and ownership"],
  };
}

function selectTopAuthor(aggregate: WindowAggregate): AuthorStats | undefined {
  return [...aggregate.authorStats].sort((left, right) => {
    if (right.commits !== left.commits) {
      return right.commits - left.commits;
    }
    return `${left.authorName}<${left.authorEmail}>`.localeCompare(
      `${right.authorName}<${right.authorEmail}>`,
    );
  })[0];
}

export function buildOwnershipClarityScore(options: {
  baselineAggregate: WindowAggregate;
  historySourceID: string;
}): ExplainableScore {
  const topAuthor = selectTopAuthor(options.baselineAggregate);
  return createScore({
    key: "ownership_clarity",
    label: "Ownership clarity",
    formula: "100 * (top_author_commits / total_commits)",
    interpretation: describeOwnershipClarity(
      toPercent((topAuthor?.commits ?? 0) / Math.max(1, options.baselineAggregate.commits)),
    ),
    factors: [
      shareFactor({
        key: "top_author_commit_share",
        label: "Top-author commit share",
        numerator: topAuthor?.commits ?? 0,
        denominator: options.baselineAggregate.commits,
        numeratorLabel: "Top-author commits",
        denominatorLabel: "Baseline commits",
        weight: 1,
        sourceIDs: [options.historySourceID],
        unit: "commits",
        detail: topAuthor
          ? `${topAuthor.authorName} <${topAuthor.authorEmail}>`
          : "no recent author",
      }),
    ],
  });
}

export function buildRecentChangePressureScore(options: {
  baselineAggregate: WindowAggregate;
  recentAggregate: WindowAggregate;
  windows: StabilityWindows;
  historySourceID: string;
}): ExplainableScore {
  return createScore({
    key: "recent_change_pressure",
    label: "Recent change pressure",
    formula: "100 * (recent_window_commits / baseline_window_commits)",
    interpretation: describePressure(
      toPercent(options.recentAggregate.commits / Math.max(1, options.baselineAggregate.commits)),
      "pressure is concentrated in the recent window",
      "pressure is moderate across recent and baseline windows",
    ),
    factors: [
      shareFactor({
        key: "recent_commit_share",
        label: "Recent commit share",
        numerator: options.recentAggregate.commits,
        denominator: options.baselineAggregate.commits,
        numeratorLabel: `Recent commits (${options.windows.recentWindowDays}d)`,
        denominatorLabel: `Baseline commits (${options.windows.baselineWindowDays}d)`,
        weight: 1,
        sourceIDs: [options.historySourceID],
        unit: "commits",
      }),
    ],
  });
}

export function buildPendingChangePressureScore(options: {
  baselineAggregate: WindowAggregate;
  pendingCount: number;
  historySourceID: string;
}): ExplainableScore {
  const denominator = Math.max(
    1,
    options.baselineAggregate.rawTouchedPaths || options.pendingCount || 1,
  );
  return createScore({
    key: "pending_change_pressure",
    label: "Pending change pressure",
    formula: "100 * (pending_paths / max(1, baseline_touched_paths))",
    interpretation: describePressure(
      toPercent(options.pendingCount / denominator),
      "current uncommitted changes cover most recently touched paths",
      "current uncommitted changes cover part of the recently touched paths",
    ),
    factors: [
      shareFactor({
        key: "pending_path_share",
        label: "Pending-path share",
        numerator: options.pendingCount,
        denominator,
        numeratorLabel: "Pending paths",
        denominatorLabel: "Baseline touched paths",
        weight: 1,
        sourceIDs: ["index", "worktree", "untracked", options.historySourceID],
        unit: "paths",
      }),
    ],
  });
}

export function buildCompositeStabilityScore(scores: {
  ownershipClarity: ExplainableScore;
  recentChangePressure: ExplainableScore;
  pendingChangePressure: ExplainableScore;
}): ExplainableScore {
  return createScore({
    key: "stability",
    label: "Stability",
    formula:
      "(ownership_clarity + (100 - recent_change_pressure) + (100 - pending_change_pressure)) / 3",
    interpretation: "watch",
    factors: [
      {
        key: "ownership_clarity_factor",
        label: "Ownership clarity",
        weight: 1 / 3,
        value: scores.ownershipClarity.value,
        contribution: round(scores.ownershipClarity.value / 3),
        explanation: "Higher recent ownership clarity improves stability.",
        signals: scores.ownershipClarity.signals,
      },
      {
        key: "change_calmness_factor",
        label: "Change calmness",
        weight: 1 / 3,
        value: round(100 - scores.recentChangePressure.value),
        contribution: round((100 - scores.recentChangePressure.value) / 3),
        explanation: "Less short-window concentration improves stability.",
        signals: scores.recentChangePressure.signals,
      },
      {
        key: "clean_worktree_factor",
        label: "Clean worktree",
        weight: 1 / 3,
        value: round(100 - scores.pendingChangePressure.value),
        contribution: round((100 - scores.pendingChangePressure.value) / 3),
        explanation: "Fewer pending changes on recently touched paths improves stability.",
        signals: scores.pendingChangePressure.signals,
      },
    ],
  });
}

export function interpretStabilityScore(value: number): string {
  return value >= 70
    ? "steady recent history"
    : value >= 45
      ? "mixed recent stability"
      : "fragile recent stability";
}

export function buildStabilityScores(options: {
  baselineAggregate: WindowAggregate;
  recentAggregate: WindowAggregate;
  windows: StabilityWindows;
  pendingCount: number;
  historySourceID: string;
}): z.infer<typeof ProvStabilityReportDataSchema>["scores"] {
  const ownershipClarity = buildOwnershipClarityScore(options);
  const recentChangePressure = buildRecentChangePressureScore(options);
  const pendingChangePressure = buildPendingChangePressureScore(options);
  const stability = buildCompositeStabilityScore({
    ownershipClarity,
    recentChangePressure,
    pendingChangePressure,
  });

  return {
    stability: {
      ...stability,
      interpretation: interpretStabilityScore(stability.value),
    },
    ownershipClarity,
    recentChangePressure,
    pendingChangePressure,
  };
}
