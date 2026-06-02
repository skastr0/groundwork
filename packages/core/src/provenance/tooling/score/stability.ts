import { tool, type ToolDefinition } from "../tool.ts";
import { z } from "zod";
import { provenanceModeArg, resolveBoundedNumber } from "../args.ts";
import { createProvenanceSuccess, type ProvenanceConfidence, type ProvenanceEvidenceSource, type ProvenanceWarning } from "../contracts.ts";
import { createLocalToolFailure, createUnsupportedModeFailure, dedupeSources, dedupeWarnings, getHighestAmbiguity, getLowestConfidence, toErrorMessage } from "../shared.ts";
import { resolveLocalRepoState, toProvRepoStateData, type CreateStateToolsOptions } from "../state/internal.ts";
import { logger } from "../utils/logger.ts";
import { ANALYSIS_LIMIT_OPTIONS, GW_STABILITY_REPORT_TOOL } from "./constants.ts";
import { buildRepoSources, toRepoAmbiguityWarnings } from "./evidence.ts";
import { buildAnalysisHistorySourceID, buildHistorySource, createHistoryWarnings, inferHistoryConfidence, toLoadedHistoryFromSummary } from "./history-summary.ts";
import { loadHistory, normalizeAnalysisPath, normalizeWindowDays } from "./history-loader.ts";
import { buildStabilityReportData, buildStabilityWindowAggregates, collectStabilityPendingPaths, resolveStabilityWindows } from "./stability-model.ts";
import { buildStabilityScores } from "./stability-scores.ts";
import { analysisLimitArg, baselineWindowArg, historyMaxCommitsArg, optionalPathArg, recentWindowArg } from "./tool-args.ts";
import { ProvStabilityReportDataSchema } from "./schemas.ts";
import type { StabilityReportToolInput } from "./types.ts";

export async function executeStabilityReport(
  options: CreateStateToolsOptions,
  args: {
    path?: string;
    recent_window_days?: number;
    baseline_window_days?: number;
    limit?: number;
    max_commits?: number;
  },
): Promise<{
  data: z.infer<typeof ProvStabilityReportDataSchema>;
  historySourceID: string;
}> {
  const resolvedPath = normalizeAnalysisPath(args.path, options.rootDir);
  const requestedPath = args.path?.trim() || ".";
  const limit = resolveBoundedNumber(args.limit, ANALYSIS_LIMIT_OPTIONS);
  const windows = resolveStabilityWindows(args);
  const [repoState, history] = await Promise.all([
    resolveLocalRepoState({ shell: options.shell }),
    loadHistory({
      shell: options.shell,
      resolvedPath,
      windowDays: normalizeWindowDays(
        [windows.recentWindowDays, windows.baselineWindowDays],
        [windows.recentWindowDays, windows.baselineWindowDays],
      ),
      maxCommits: args.max_commits,
    }),
  ]);

  const repo = toProvRepoStateData(repoState, limit);
  const historySourceID = buildAnalysisHistorySourceID("stability", resolvedPath);
  const aggregates = buildStabilityWindowAggregates({ history, resolvedPath, windows });
  const pending = collectStabilityPendingPaths(repoState, resolvedPath);
  const scores = buildStabilityScores({
    baselineAggregate: aggregates.baselineAggregate,
    recentAggregate: aggregates.recentAggregate,
    windows,
    pendingCount: pending.allPending.size,
    historySourceID,
  });

  return {
    data: buildStabilityReportData({
      requestedPath,
      resolvedPath,
      repo,
      history,
      windows,
      aggregates,
      pending,
      scores,
    }),
    historySourceID,
  };
}

export function buildStabilitySummary(data: z.infer<typeof ProvStabilityReportDataSchema>): string {
  return `Stability for ${data.anchor.resolvedPath}: ${data.scores.stability.value}/100 (${data.assessment.label}), recent pressure ${data.scores.recentChangePressure.value}, pending pressure ${data.scores.pendingChangePressure.value}.`;
}

export function createStabilityReportTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
  return tool({
    description:
      "Report recent path stability with explicit component scores, factor breakdowns, and pending-change pressure.",
    args: {
      path: optionalPathArg,
      recent_window_days: recentWindowArg,
      baseline_window_days: baselineWindowArg,
      limit: analysisLimitArg,
      max_commits: historyMaxCommitsArg,
      mode: provenanceModeArg,
    },
    execute: (args: StabilityReportToolInput) =>
      executeStabilityReportTool(runtimeOptions, args),
  });
}

async function executeStabilityReportTool(
  runtimeOptions: CreateStateToolsOptions,
  args: StabilityReportToolInput,
): Promise<string> {
  const mode = args.mode ?? "local";
  if (mode !== "local") {
    return createUnsupportedStabilityReportModeFailure(mode);
  }

  logStabilityReportStart(args);

  try {
    const result = await executeStabilityReport(runtimeOptions, args);
    const response = createStabilityReportSuccess(result);
    logStabilityReportEnd(result.data);
    return JSON.stringify(response, null, 2);
  } catch (error) {
    return createStabilityReportFailure(args, error);
  }
}

function createUnsupportedStabilityReportModeFailure(mode: "remote" | "hybrid"): string {
  logger.warn("gw_stability_report unsupported mode", {
    tool: GW_STABILITY_REPORT_TOOL,
    mode,
  });
  return createUnsupportedModeFailure(GW_STABILITY_REPORT_TOOL, mode);
}

function logStabilityReportStart(args: StabilityReportToolInput): void {
  logger.info("gw_stability_report start", {
    tool: GW_STABILITY_REPORT_TOOL,
    path: args.path ?? ".",
    recentWindowDays: args.recent_window_days,
    baselineWindowDays: args.baseline_window_days,
    limit: args.limit,
    maxCommits: args.max_commits,
  });
}

function createStabilityReportSuccess(result: {
  data: z.infer<typeof ProvStabilityReportDataSchema>;
  historySourceID: string;
}) {
  const warnings = createStabilityReportWarnings(result.data);
  return createProvenanceSuccess({
    tool: GW_STABILITY_REPORT_TOOL,
    mode: "local",
    confidence: inferStabilityReportConfidence(result.data),
    ambiguity: getHighestAmbiguity([
      result.data.repo.ambiguity.level,
      ...warnings.map((warning) => warning.ambiguity ?? "low"),
    ]),
    summary: buildStabilitySummary(result.data),
    warnings,
    sources: createStabilityReportSources(result),
    data: result.data,
  });
}

function createStabilityReportWarnings(
  data: z.infer<typeof ProvStabilityReportDataSchema>,
): ProvenanceWarning[] {
  return dedupeWarnings([
    ...toRepoAmbiguityWarnings(data.repo),
    ...createHistoryWarnings({
      prefix: "Stability",
      totalCommits: data.history.totalCommits,
      loadedCommits: data.history.loadedCommits,
      resolvedPath: data.anchor.resolvedPath,
      emptyMessage: `No matching non-merge commits were found for '${data.anchor.resolvedPath}'.`,
    }),
  ]);
}

function inferStabilityReportConfidence(
  data: z.infer<typeof ProvStabilityReportDataSchema>,
): ProvenanceConfidence {
  return getLowestConfidence([
    data.repo.branch.confidence,
    inferHistoryConfidence(toLoadedHistoryFromSummary(data.history)),
  ]);
}

function createStabilityReportSources(result: {
  data: z.infer<typeof ProvStabilityReportDataSchema>;
  historySourceID: string;
}): ProvenanceEvidenceSource[] {
  const data = result.data;
  return dedupeSources([
    ...buildRepoSources(data.repo),
    buildHistorySource({
      id: result.historySourceID,
      resolvedPath: data.anchor.resolvedPath,
      history: toLoadedHistoryFromSummary(data.history),
    }),
  ]);
}

function logStabilityReportEnd(data: z.infer<typeof ProvStabilityReportDataSchema>): void {
  logger.info("gw_stability_report end", {
    tool: GW_STABILITY_REPORT_TOOL,
    path: data.anchor.resolvedPath,
    stability: data.scores.stability.value,
    assessment: data.assessment.label,
  });
}

function createStabilityReportFailure(args: StabilityReportToolInput, error: unknown): string {
  const message = toErrorMessage(error);
  logger.error("gw_stability_report failed", {
    tool: GW_STABILITY_REPORT_TOOL,
    path: args.path ?? ".",
    error: message,
  });
  return createLocalToolFailure({
    tool: GW_STABILITY_REPORT_TOOL,
    summary: `Failed to build a stability report for '${args.path ?? "."}'.`,
    code: "STABILITY_REPORT_UNAVAILABLE",
    message,
  });
}
