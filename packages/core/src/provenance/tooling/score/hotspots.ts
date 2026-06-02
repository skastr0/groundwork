import { tool, type ToolDefinition } from "../tool.ts";
import { z } from "zod";
import { provenanceModeArg, resolveBoundedNumber } from "../args.ts";
import { createProvenanceSuccess, type ProvenanceConfidence, type ProvenanceEvidenceSource, type ProvenanceWarning } from "../contracts.ts";
import { createLocalToolFailure, createUnsupportedModeFailure, dedupeSources, dedupeWarnings, getHighestAmbiguity, getLowestConfidence, toErrorMessage } from "../shared.ts";
import { resolveLocalRepoState, toProvRepoStateData, type CreateStateToolsOptions } from "../state/internal.ts";
import { logger } from "../utils/logger.ts";
import { aggregateWindow, compareHotspotByActivity, compareHotspotByChurn, filterHistoryByWindow } from "./aggregation.ts";
import { ANALYSIS_LIMIT_OPTIONS, DAY_MS, DEFAULT_HOTSPOT_WINDOWS, DIRECTORY_DEPTH_OPTIONS, GW_HOTSPOTS_TOOL } from "./constants.ts";
import { buildRepoSources, toRepoAmbiguityWarnings } from "./evidence.ts";
import { buildAnalysisHistorySourceID, buildHistorySource, buildHistorySummary, createHistoryWarnings, inferHistoryConfidence, toLoadedHistoryFromSummary } from "./history-summary.ts";
import { loadHistory, normalizeAnalysisPath, normalizeWindowDays } from "./history-loader.ts";
import { toHotspotItem } from "./hotspot-items.ts";
import { analysisLimitArg, directoryDepthArg, historyMaxCommitsArg, hotspotGroupByArg, hotspotWindowsArg, optionalPathArg } from "./tool-args.ts";
import { ProvHotspotsDataSchema, type HotspotWindow } from "./schemas.ts";
import type { HotspotsToolInput, LoadedHistory } from "./types.ts";

export function buildHotspotWindows(options: {
  history: LoadedHistory;
  resolvedPath: string;
  groupBy: "file" | "directory";
  directoryDepth: number;
  limit: number;
  windowDays: number[];
  historySourceID: string;
}): HotspotWindow[] {
  const anchorMs = options.history.headAuthoredAtMs;
  const anchorTimestamp = options.history.headAuthoredAt;
  if (anchorMs === null || !anchorTimestamp) {
    return [];
  }

  return options.windowDays.map((days) => {
    const since = new Date(anchorMs - days * DAY_MS).toISOString();
    const filtered = filterHistoryByWindow(options.history.commits, Date.parse(since));
    const aggregate = aggregateWindow({
      commits: filtered,
      anchorPath: options.resolvedPath,
      groupBy: options.groupBy,
      directoryDepth: options.directoryDepth,
    });

    const highestChurn = [...aggregate.pathStats]
      .sort(compareHotspotByChurn)
      .slice(0, options.limit)
      .map((stats) => toHotspotItem(stats, options.historySourceID));
    const mostActive = [...aggregate.pathStats]
      .sort(compareHotspotByActivity)
      .slice(0, options.limit)
      .map((stats) => toHotspotItem(stats, options.historySourceID));
    const hints: string[] = [];

    if (aggregate.pathStats.length > options.limit) {
      hints.push(`Hotspot rankings were truncated to ${options.limit} path(s).`);
    }

    return {
      days,
      since,
      until: anchorTimestamp,
      commitCount: aggregate.commits,
      touchedPaths: aggregate.touchedPaths,
      highestChurn,
      mostActive,
      hints,
    };
  });
}

export async function executeHotspots(
  options: CreateStateToolsOptions,
  args: {
    path?: string;
    windows?: number[];
    group_by?: "file" | "directory";
    directory_depth?: number;
    limit?: number;
    max_commits?: number;
  },
): Promise<z.infer<typeof ProvHotspotsDataSchema>> {
  const resolvedPath = normalizeAnalysisPath(args.path, options.rootDir);
  const requestedPath = args.path?.trim() || ".";
  const windowDays = normalizeWindowDays(args.windows, DEFAULT_HOTSPOT_WINDOWS);
  const groupBy = args.group_by ?? "file";
  const directoryDepth = resolveBoundedNumber(args.directory_depth, DIRECTORY_DEPTH_OPTIONS);
  const limit = resolveBoundedNumber(args.limit, ANALYSIS_LIMIT_OPTIONS);
  const [repoState, history] = await Promise.all([
    resolveLocalRepoState({
      shell: options.shell,
    }),
    loadHistory({
      shell: options.shell,
      resolvedPath,
      windowDays,
      maxCommits: args.max_commits,
    }),
  ]);

  const repo = toProvRepoStateData(repoState, limit);
  const historySourceID = buildAnalysisHistorySourceID("hotspots", resolvedPath);

  return {
    anchor: {
      requestedPath,
      resolvedPath,
      groupBy,
      directoryDepth,
    },
    repo,
    history: buildHistorySummary(history),
    windows: buildHotspotWindows({
      history,
      resolvedPath,
      groupBy,
      directoryDepth,
      limit,
      windowDays,
      historySourceID,
    }),
  };
}

export function buildHotspotsSummary(data: z.infer<typeof ProvHotspotsDataSchema>): string {
  const latestWindow = data.windows.at(-1);
  const topActive = latestWindow?.mostActive[0];
  const topChurn = latestWindow?.highestChurn[0];
  if (!latestWindow) {
    return `Hotspots for ${data.anchor.resolvedPath}: no history windows were available.`;
  }

  return `Hotspots for ${data.anchor.resolvedPath}: ${latestWindow.days}d top activity ${topActive?.path ?? "none"} (${topActive?.commitCount ?? 0} commit(s)), top churn ${topChurn?.path ?? "none"} (${topChurn?.churn ?? 0} changed line(s)).`;
}

export function createHotspotsTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
  return tool({
    description:
      "Rank the highest-churn and most-active files or directory paths over deterministic history windows anchored to HEAD.",
    args: {
      path: optionalPathArg,
      windows: hotspotWindowsArg,
      group_by: hotspotGroupByArg,
      directory_depth: directoryDepthArg,
      limit: analysisLimitArg,
      max_commits: historyMaxCommitsArg,
      mode: provenanceModeArg,
    },
    execute: (args: HotspotsToolInput) => executeHotspotsTool(runtimeOptions, args),
  });
}

async function executeHotspotsTool(
  runtimeOptions: CreateStateToolsOptions,
  args: HotspotsToolInput,
): Promise<string> {
  const mode = args.mode ?? "local";
  if (mode !== "local") {
    return createUnsupportedHotspotsModeFailure(mode);
  }

  logHotspotsStart(args);

  try {
    const data = await executeHotspots(runtimeOptions, args);
    const response = createHotspotsSuccess(data);
    logHotspotsEnd(data);
    return JSON.stringify(response, null, 2);
  } catch (error) {
    return createHotspotsFailure(args, error);
  }
}

function createUnsupportedHotspotsModeFailure(mode: "remote" | "hybrid"): string {
  logger.warn("gw_hotspots unsupported mode", { tool: GW_HOTSPOTS_TOOL, mode });
  return createUnsupportedModeFailure(GW_HOTSPOTS_TOOL, mode);
}

function logHotspotsStart(args: HotspotsToolInput): void {
  logger.info("gw_hotspots start", {
    tool: GW_HOTSPOTS_TOOL,
    path: args.path ?? ".",
    windows: args.windows,
    groupBy: args.group_by ?? "file",
    directoryDepth: args.directory_depth,
    limit: args.limit,
    maxCommits: args.max_commits,
  });
}

function createHotspotsSuccess(data: z.infer<typeof ProvHotspotsDataSchema>) {
  const warnings = createHotspotsWarnings(data);
  return createProvenanceSuccess({
    tool: GW_HOTSPOTS_TOOL,
    mode: "local",
    confidence: inferHotspotsConfidence(data),
    ambiguity: getHighestAmbiguity([
      data.repo.ambiguity.level,
      ...warnings.map((warning) => warning.ambiguity ?? "low"),
    ]),
    summary: buildHotspotsSummary(data),
    warnings,
    sources: createHotspotsSources(data),
    data,
  });
}

function createHotspotsWarnings(
  data: z.infer<typeof ProvHotspotsDataSchema>,
): ProvenanceWarning[] {
  return dedupeWarnings([
    ...toRepoAmbiguityWarnings(data.repo),
    ...createHistoryWarnings({
      totalCommits: data.history.totalCommits,
      loadedCommits: data.history.loadedCommits,
      resolvedPath: data.anchor.resolvedPath,
    }),
  ]);
}

function inferHotspotsConfidence(
  data: z.infer<typeof ProvHotspotsDataSchema>,
): ProvenanceConfidence {
  return getLowestConfidence([
    data.repo.branch.confidence,
    inferHistoryConfidence(toLoadedHistoryFromSummary(data.history)),
  ]);
}

function createHotspotsSources(
  data: z.infer<typeof ProvHotspotsDataSchema>,
): ProvenanceEvidenceSource[] {
  return dedupeSources([
    ...buildRepoSources(data.repo),
    buildHistorySource({
      id: buildAnalysisHistorySourceID("hotspots", data.anchor.resolvedPath),
      resolvedPath: data.anchor.resolvedPath,
      history: toLoadedHistoryFromSummary(data.history),
    }),
  ]);
}

function logHotspotsEnd(data: z.infer<typeof ProvHotspotsDataSchema>): void {
  logger.info("gw_hotspots end", {
    tool: GW_HOTSPOTS_TOOL,
    path: data.anchor.resolvedPath,
    windows: data.windows.length,
    totalCommits: data.history.totalCommits,
  });
}

function createHotspotsFailure(args: HotspotsToolInput, error: unknown): string {
  const message = toErrorMessage(error);
  logger.error("gw_hotspots failed", {
    tool: GW_HOTSPOTS_TOOL,
    path: args.path ?? ".",
    error: message,
  });
  return createLocalToolFailure({
    tool: GW_HOTSPOTS_TOOL,
    summary: `Failed to resolve hotspots for '${args.path ?? "."}'.`,
    code: "HOTSPOTS_UNAVAILABLE",
    message,
  });
}
