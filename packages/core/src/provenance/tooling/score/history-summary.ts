import { type ProvenanceConfidence, type ProvenanceEvidenceSource, type ProvenanceWarning } from "../contracts.ts";
import { HISTORY_DETECTION_METHOD, HISTORY_HEAD_ANCHOR_METHOD } from "./constants.ts";
import type { HistorySummary } from "./schemas.ts";
import type { LoadedHistory } from "./types.ts";

export function buildHistorySource(options: {
  id: string;
  resolvedPath: string;
  history: LoadedHistory;
}): ProvenanceEvidenceSource {
  return {
    kind: "git",
    id: options.id,
    path: options.resolvedPath,
    ref: options.history.oldestSince
      ? `${options.history.oldestSince}..${options.history.headAuthoredAt ?? "HEAD"}`
      : undefined,
    label: "history scan",
    detail: `${options.history.commits.length}/${options.history.totalCommits} commit(s) loaded`,
  };
}

export function createHistoryWarnings(options: {
  prefix?: string;
  totalCommits: number;
  loadedCommits: number;
  resolvedPath: string;
  emptyCode?: "HISTORY_EMPTY" | "AUTHORITY_EMPTY";
  emptyMessage?: string;
}): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [];
  if (options.totalCommits > options.loadedCommits) {
    const subject = options.prefix ? `${options.prefix} scan` : "History scan";
    warnings.push({
      code: "HISTORY_COMMITS_TRUNCATED",
      message: `${subject} loaded ${options.loadedCommits}/${options.totalCommits} commit(s).`,
      ambiguity: "low",
    });
  }
  if (options.totalCommits === 0) {
    warnings.push({
      code: options.emptyCode ?? "HISTORY_EMPTY",
      message:
        options.emptyMessage ??
        `No matching non-merge commits were found for '${options.resolvedPath}' in the requested window.`,
      ambiguity: "low",
    });
  }

  return warnings;
}

export function buildHistorySummary(history: LoadedHistory): HistorySummary {
  return {
    headCommit: history.headCommit,
    headAuthoredAt: history.headAuthoredAt,
    headAuthoredAtMs: history.headAuthoredAtMs ?? 0,
    oldestSince: history.oldestSince,
    totalCommits: history.totalCommits,
    loadedCommits: history.commits.length,
    bounds: history.bounds,
    detectionMethod: history.detectionMethod,
  };
}

export function buildAnalysisHistorySourceID(
  analysis: "hotspots" | "authority" | "stability",
  resolvedPath: string,
): string {
  return `${analysis}-history:${resolvedPath}`;
}

export function toLoadedHistoryFromSummary(history: HistorySummary): LoadedHistory {
  return {
    headCommit: history.headCommit,
    headAuthoredAt: history.headAuthoredAt,
    headAuthoredAtMs: history.headAuthoredAtMs,
    oldestSince: history.oldestSince,
    totalCommits: history.totalCommits,
    commits: [],
    bounds: history.bounds,
    detectionMethod: history.detectionMethod,
  };
}

export function inferHistoryConfidence(history: LoadedHistory): ProvenanceConfidence {
  if (!history.headCommit || !history.headAuthoredAt) {
    return "unknown";
  }
  if (history.totalCommits === 0) {
    return "low";
  }
  if (history.bounds.truncated) {
    return "medium";
  }
  return "high";
}
