import { MAX_SAMPLE_AUTHORS } from "./constants.ts";
import { createSignal } from "./score-primitives.ts";
import type { AuthorSample, HotspotItem } from "./schemas.ts";
import type { MutablePathStats } from "./types.ts";

function toSampleAuthors(stats: MutablePathStats): AuthorSample[] {
  return [...stats.authorCommitCounts.entries()]
    .map(([key, commits]) => ({
      key,
      commits,
      metadata: stats.authorMetadata.get(key),
    }))
    .filter(
      (
        entry,
      ): entry is {
        key: string;
        commits: number;
        metadata: { authorName: string; authorEmail: string };
      } => Boolean(entry.metadata),
    )
    .sort((left, right) => {
      if (right.commits !== left.commits) {
        return right.commits - left.commits;
      }
      return left.key.localeCompare(right.key);
    })
    .slice(0, MAX_SAMPLE_AUTHORS)
    .map((entry) => ({
      authorName: entry.metadata.authorName,
      authorEmail: entry.metadata.authorEmail,
      commits: entry.commits,
    }));
}

export function toHotspotItem(stats: MutablePathStats, historySourceID: string): HotspotItem {
  return {
    path: stats.path,
    commitCount: stats.commitCount,
    uniqueAuthors: stats.authors.size,
    additions: stats.additions,
    deletions: stats.deletions,
    churn: stats.churn,
    lastTouchedAt: stats.lastTouchedAt,
    sampleAuthors: toSampleAuthors(stats),
    signals: [
      createSignal({
        key: "commit_count",
        label: "Commit count",
        value: stats.commitCount,
        unit: "commits",
        sourceIDs: [historySourceID],
      }),
      createSignal({
        key: "unique_authors",
        label: "Unique authors",
        value: stats.authors.size,
        unit: "authors",
        sourceIDs: [historySourceID],
      }),
      createSignal({
        key: "additions",
        label: "Additions",
        value: stats.additions,
        unit: "lines",
        sourceIDs: [historySourceID],
      }),
      createSignal({
        key: "deletions",
        label: "Deletions",
        value: stats.deletions,
        unit: "lines",
        sourceIDs: [historySourceID],
      }),
      createSignal({
        key: "churn",
        label: "Churn",
        value: stats.churn,
        unit: "lines",
        sourceIDs: [historySourceID],
      }),
      createSignal({
        key: "last_touched_at",
        label: "Last touched at",
        value: stats.lastTouchedAt ?? "unavailable",
        sourceIDs: [historySourceID],
      }),
    ],
  };
}
