import { tool, type ToolDefinition } from "../tool.ts";
import { z } from "zod";
import { provenanceModeArg, resolveBoundedNumber } from "../args.ts";
import { createProvenanceSuccess, type ProvenanceConfidence, type ProvenanceEvidenceSource, type ProvenanceWarning } from "../contracts.ts";
import { createLocalToolFailure, createUnsupportedModeFailure, dedupeSources, dedupeWarnings, getHighestAmbiguity, getLowestConfidence, toErrorMessage } from "../shared.ts";
import { resolveLocalRepoState, toProvRepoStateData, type CreateStateToolsOptions } from "../state/internal.ts";
import { logger } from "../utils/logger.ts";
import { aggregateWindow, compareAuthors, filterHistoryByWindow } from "./aggregation.ts";
import { ANALYSIS_LIMIT_OPTIONS, DAY_MS, DEFAULT_AUTHORITY_WINDOW_DAYS, GW_AUTHORITY_TOOL } from "./constants.ts";
import { buildRepoSources, toRepoAmbiguityWarnings } from "./evidence.ts";
import { buildAnalysisHistorySourceID, buildHistorySource, buildHistorySummary, createHistoryWarnings, toLoadedHistoryFromSummary } from "./history-summary.ts";
import { loadHistory, normalizeAnalysisPath, normalizeWindowDays } from "./history-loader.ts";
import { createScore, describeAuthority, shareFactor } from "./score-primitives.ts";
import { analysisLimitArg, authorityWindowArg, historyMaxCommitsArg, optionalPathArg } from "./tool-args.ts";
import { ProvAuthorityDataSchema, type AuthorityTotals, type ExplainableScore } from "./schemas.ts";
import type { AuthorityToolInput, AuthorStats } from "./types.ts";

type AuthorityAggregate = ReturnType<typeof aggregateWindow>;

export function buildAuthorityScore(options: {
  author: AuthorStats;
  totals: AuthorityTotals;
  historySourceID: string;
}): ExplainableScore {
  const factors = [
    shareFactor({
      key: "commit_share",
      label: "Commit share",
      numerator: options.author.commits,
      denominator: options.totals.commits,
      numeratorLabel: "Author commits",
      denominatorLabel: "All commits",
      weight: 0.5,
      sourceIDs: [options.historySourceID],
      unit: "commits",
    }),
    shareFactor({
      key: "churn_share",
      label: "Churn share",
      numerator: options.author.churn,
      denominator: options.totals.churn,
      numeratorLabel: "Author churn",
      denominatorLabel: "All churn",
      weight: 0.3,
      sourceIDs: [options.historySourceID],
      unit: "lines",
    }),
    shareFactor({
      key: "path_share",
      label: "Touched-path share",
      numerator: options.author.uniquePaths.size,
      denominator: options.totals.touchedPaths,
      numeratorLabel: "Author unique paths",
      denominatorLabel: "All touched paths",
      weight: 0.2,
      sourceIDs: [options.historySourceID],
      unit: "paths",
    }),
  ];

  const preview = createScore({
    key: "authority",
    label: "Authority score",
    formula: "100 * (0.50 * commit_share + 0.30 * churn_share + 0.20 * touched_path_share)",
    interpretation: "shared authority",
    factors,
  });

  return {
    ...preview,
    interpretation: describeAuthority(preview.value),
  };
}

function toAuthorityTotals(aggregate: AuthorityAggregate): AuthorityTotals {
  return {
    commits: aggregate.commits,
    touchedPaths: aggregate.rawTouchedPaths,
    uniqueAuthors: aggregate.uniqueAuthors,
    additions: aggregate.additions,
    deletions: aggregate.deletions,
    churn: aggregate.churn,
  };
}

function buildAuthorityLeaders(options: {
  aggregate: AuthorityAggregate;
  totals: AuthorityTotals;
  historySourceID: string;
  limit: number;
}) {
  return options.aggregate.authorStats
    .map((author) => {
      const score = buildAuthorityScore({
        author,
        totals: options.totals,
        historySourceID: options.historySourceID,
      });
      return {
        authorName: author.authorName,
        authorEmail: author.authorEmail,
        commits: author.commits,
        uniquePaths: author.uniquePaths.size,
        additions: author.additions,
        deletions: author.deletions,
        churn: author.churn,
        lastTouchedAt: author.lastTouchedAt,
        score,
      };
    })
    .sort((left, right) => compareAuthors(left, right))
    .slice(0, options.limit);
}

export async function executeAuthority(
  options: CreateStateToolsOptions,
  args: {
    path?: string;
    window_days?: number;
    limit?: number;
    max_commits?: number;
  },
): Promise<z.infer<typeof ProvAuthorityDataSchema>> {
  const resolvedPath = normalizeAnalysisPath(args.path, options.rootDir);
  const requestedPath = args.path?.trim() || ".";
  const limit = resolveBoundedNumber(args.limit, ANALYSIS_LIMIT_OPTIONS);
  const windowDays = normalizeWindowDays(
    [args.window_days ?? DEFAULT_AUTHORITY_WINDOW_DAYS],
    [DEFAULT_AUTHORITY_WINDOW_DAYS],
  );
  const [repoState, history] = await Promise.all([
    resolveLocalRepoState({ shell: options.shell }),
    loadHistory({
      shell: options.shell,
      resolvedPath,
      windowDays,
      maxCommits: args.max_commits,
    }),
  ]);

  const repo = toProvRepoStateData(repoState, limit);
  const historySourceID = buildAnalysisHistorySourceID("authority", resolvedPath);
  const anchorMs = history.headAuthoredAtMs ?? Date.now();
  const days = windowDays[0] ?? DEFAULT_AUTHORITY_WINDOW_DAYS;
  const since = new Date(anchorMs - days * DAY_MS).toISOString();
  const aggregate = aggregateWindow({
    commits: filterHistoryByWindow(history.commits, Date.parse(since)),
    anchorPath: resolvedPath,
    groupBy: "file",
    directoryDepth: 1,
  });

  const totals = toAuthorityTotals(aggregate);
  const leaders = buildAuthorityLeaders({ aggregate, totals, historySourceID, limit });

  return {
    anchor: {
      requestedPath,
      resolvedPath,
    },
    repo,
    history: buildHistorySummary(history),
    window: {
      days,
      since,
      until: history.headAuthoredAt ?? since,
    },
    totals,
    leaders,
  };
}

export function buildAuthoritySummary(data: z.infer<typeof ProvAuthorityDataSchema>): string {
  const leader = data.leaders[0];
  if (!leader) {
    return `Authority for ${data.anchor.resolvedPath}: no recent authors were found in the ${data.window.days}d window.`;
  }

  return `Authority for ${data.anchor.resolvedPath}: ${leader.authorName} leads with ${leader.score.value}/100 from ${leader.commits}/${Math.max(data.totals.commits, 1)} commit(s) in the ${data.window.days}d window.`;
}

export function createAuthorityTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
  return tool({
    description:
      "Rank recent author authority for one path using explicit commit, churn, and touched-path shares with cited signals.",
    args: {
      path: optionalPathArg,
      window_days: authorityWindowArg,
      limit: analysisLimitArg,
      max_commits: historyMaxCommitsArg,
      mode: provenanceModeArg,
    },
    execute: (args: AuthorityToolInput) => executeAuthorityTool(runtimeOptions, args),
  });
}

async function executeAuthorityTool(
  runtimeOptions: CreateStateToolsOptions,
  args: AuthorityToolInput,
): Promise<string> {
  const mode = args.mode ?? "local";
  if (mode !== "local") {
    logger.warn("gw_authority unsupported mode", { tool: GW_AUTHORITY_TOOL, mode });
    return createUnsupportedModeFailure(GW_AUTHORITY_TOOL, mode);
  }

  logAuthorityStart(args);

  try {
    const data = await executeAuthority(runtimeOptions, args);
    const warnings = buildAuthorityWarnings(data);
    const response = createProvenanceSuccess({
      tool: GW_AUTHORITY_TOOL,
      mode: "local",
      confidence: getAuthorityConfidence(data),
      ambiguity: getHighestAmbiguity([
        data.repo.ambiguity.level,
        ...warnings.map((warning) => warning.ambiguity ?? "low"),
      ]),
      summary: buildAuthoritySummary(data),
      warnings,
      sources: buildAuthoritySources(data),
      data,
    });

    logAuthorityEnd(data);
    return JSON.stringify(response, null, 2);
  } catch (error) {
    return createAuthorityFailure(args, error);
  }
}

function logAuthorityStart(args: AuthorityToolInput): void {
  logger.info("gw_authority start", {
    tool: GW_AUTHORITY_TOOL,
    path: args.path ?? ".",
    windowDays: args.window_days,
    limit: args.limit,
    maxCommits: args.max_commits,
  });
}

function buildAuthorityWarnings(data: z.infer<typeof ProvAuthorityDataSchema>): ProvenanceWarning[] {
  return dedupeWarnings([
    ...toRepoAmbiguityWarnings(data.repo),
    ...createHistoryWarnings({
      prefix: "Authority",
      totalCommits: data.history.totalCommits,
      loadedCommits: data.history.loadedCommits,
      resolvedPath: data.anchor.resolvedPath,
      emptyCode: "AUTHORITY_EMPTY",
      emptyMessage: `No recent authority signals were found for '${data.anchor.resolvedPath}'.`,
    }),
  ]);
}

function buildAuthoritySources(
  data: z.infer<typeof ProvAuthorityDataSchema>,
): ProvenanceEvidenceSource[] {
  const historySourceID = buildAnalysisHistorySourceID("authority", data.anchor.resolvedPath);
  return dedupeSources([
    ...buildRepoSources(data.repo),
    buildHistorySource({
      id: historySourceID,
      resolvedPath: data.anchor.resolvedPath,
      history: toLoadedHistoryFromSummary(data.history),
    }),
  ]);
}

function getAuthorityConfidence(
  data: z.infer<typeof ProvAuthorityDataSchema>,
): ProvenanceConfidence {
  return getLowestConfidence([
    data.repo.branch.confidence,
    data.totals.commits > 0 ? (data.history.bounds.truncated ? "medium" : "high") : "low",
  ]);
}

function logAuthorityEnd(data: z.infer<typeof ProvAuthorityDataSchema>): void {
  logger.info("gw_authority end", {
    tool: GW_AUTHORITY_TOOL,
    path: data.anchor.resolvedPath,
    leaders: data.leaders.length,
    commits: data.totals.commits,
  });
}

function createAuthorityFailure(args: AuthorityToolInput, error: unknown): string {
  const message = toErrorMessage(error);
  logger.error("gw_authority failed", {
    tool: GW_AUTHORITY_TOOL,
    path: args.path ?? ".",
    error: message,
  });
  return createLocalToolFailure({
    tool: GW_AUTHORITY_TOOL,
    summary: `Failed to resolve authority for '${args.path ?? "."}'.`,
    code: "AUTHORITY_UNAVAILABLE",
    message,
  });
}
