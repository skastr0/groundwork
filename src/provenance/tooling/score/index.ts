import path from "node:path";
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { runProcessText } from "../../../../shared/effect-runtime.ts";
import { z } from "zod";
import {
  createBoundedNumberArg,
  provenanceModeArg,
  provenancePathArg,
  resolveBoundedNumber,
} from "../args.ts";
import {
  createProvenanceFailure,
  createProvenanceResultSchema,
  createProvenanceSuccess,
  ProvenanceBoundsSchema,
  ProvenanceWarningSchema,
  type ProvenanceAmbiguity,
  type ProvenanceConfidence,
  type ProvenanceEvidenceSource,
  type ProvenanceWarning,
} from "../contracts.ts";
import {
  loadLocalPathEvidence,
  toProvenanceEvidenceSources,
  type LocalEvidenceMatch,
  type LocalEvidenceSourceResult,
} from "../evidence/index.ts";
import {
  normalizeCreateStateToolsOptions,
  normalizeRequestedPath,
  resolveLocalRepoState,
  toProvRepoStateData,
  ProvRepoStateDataSchema,
  type CreateStateToolsOptions,
  type LocalRepoFileStatus,
} from "../state/index.ts";
import { logger } from "../utils/logger.ts";

const GW_HOTSPOTS_TOOL = "gw_hotspots" as const;
const GW_AUTHORITY_TOOL = "gw_authority" as const;
const GW_STABILITY_REPORT_TOOL = "gw_stability_report" as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WINDOW_COUNT = 6;
const MAX_SAMPLE_AUTHORS = 3;

const DEFAULT_HOTSPOT_WINDOWS = [7, 30, 90] as const;
const DEFAULT_AUTHORITY_WINDOW_DAYS = 90;
const DEFAULT_STABILITY_RECENT_WINDOW_DAYS = 14;
const DEFAULT_STABILITY_BASELINE_WINDOW_DAYS = 90;

const HISTORY_HEAD_ANCHOR_METHOD = "git log -1 --format=%H%x1f%aI HEAD";
const HISTORY_DETECTION_METHOD =
  "git rev-list --count --no-merges --since=<timestamp> HEAD -- <path> + git log --find-renames --no-merges --numstat -n <limit> --since=<timestamp> --format=%H%x1f%aI%x1f%an%x1f%ae%x1f%s HEAD -- <path>";

const ANALYSIS_LIMIT_OPTIONS = {
  defaultValue: 5,
  maxValue: 25,
} as const;

const HISTORY_COMMIT_LIMIT_OPTIONS = {
  defaultValue: 250,
  maxValue: 2000,
} as const;

const DIRECTORY_DEPTH_OPTIONS = {
  defaultValue: 2,
  maxValue: 8,
  minValue: 1,
} as const;

const historyParseMaxOutputBytes = 256_000;

const analysisLimitArg = createBoundedNumberArg({
  ...ANALYSIS_LIMIT_OPTIONS,
  description: "Max ranked hotspot rows, authors, and evidence items to return",
});

const historyMaxCommitsArg = createBoundedNumberArg({
  ...HISTORY_COMMIT_LIMIT_OPTIONS,
  description: "Max historical commits to scan per analysis",
});

const directoryDepthArg = createBoundedNumberArg({
  ...DIRECTORY_DEPTH_OPTIONS,
  description: "Directory depth to aggregate when grouping hotspots by path",
});

const optionalPathArg = provenancePathArg
  .optional()
  .describe("Workspace-relative or absolute path anchor to inspect (default: .)");

const hotspotWindowsArg = z
  .array(z.number().int().min(1).max(3650))
  .min(1)
  .max(MAX_WINDOW_COUNT)
  .optional()
  .describe("Lookback windows in whole days, anchored to HEAD authored time (default: 7, 30, 90)");

const authorityWindowArg = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe("Lookback window in whole days, anchored to HEAD authored time (default: 90)");

const recentWindowArg = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe("Recent lookback window in whole days, anchored to HEAD authored time (default: 14)");

const baselineWindowArg = z
  .number()
  .int()
  .min(1)
  .max(3650)
  .optional()
  .describe("Baseline lookback window in whole days, anchored to HEAD authored time (default: 90)");

const hotspotGroupByArg = z
  .enum(["file", "directory"])
  .optional()
  .describe("Aggregate hotspots by file or by directory path (default: file)");

const EvidenceSourceSummarySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    totalMatches: z.number().int().nonnegative(),
    bounds: ProvenanceBoundsSchema,
    warnings: z.array(ProvenanceWarningSchema),
  }),
  z.object({
    status: z.literal("unavailable"),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  z.object({
    status: z.literal("unsupported"),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
]);

const ProvenanceSignalSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().min(1).optional(),
  detail: z.string().min(1).optional(),
  sourceIDs: z.array(z.string().min(1)).min(1),
});

const ProvenanceScoreFactorSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  weight: z.number().min(0).max(1),
  value: z.number(),
  contribution: z.number(),
  explanation: z.string().min(1),
  signals: z.array(ProvenanceSignalSchema).min(1),
});

const ExplainableScoreSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  value: z.number(),
  scale: z.object({
    min: z.number(),
    max: z.number(),
    unit: z.string().min(1),
  }),
  formula: z.string().min(1),
  interpretation: z.string().min(1),
  factors: z.array(ProvenanceScoreFactorSchema).min(1),
  signals: z.array(ProvenanceSignalSchema).min(1),
});

const AuthorSampleSchema = z.object({
  authorName: z.string().min(1),
  authorEmail: z.string().email(),
  commits: z.number().int().nonnegative(),
});

const HistorySummarySchema = z.object({
  headCommit: z.string().nullable(),
  headAuthoredAt: z.string().nullable(),
  headAuthoredAtMs: z.number().int().nonnegative(),
  oldestSince: z.string().nullable(),
  totalCommits: z.number().int().nonnegative(),
  loadedCommits: z.number().int().nonnegative(),
  bounds: ProvenanceBoundsSchema,
  detectionMethod: z.string().min(1),
});

const HotspotAnchorSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  groupBy: z.enum(["file", "directory"]),
  directoryDepth: z.number().int().positive(),
});

const HotspotItemSchema = z.object({
  path: z.string().min(1),
  commitCount: z.number().int().nonnegative(),
  uniqueAuthors: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
  lastTouchedAt: z.string().nullable(),
  sampleAuthors: z.array(AuthorSampleSchema),
  signals: z.array(ProvenanceSignalSchema).min(1),
});

const HotspotWindowSchema = z.object({
  days: z.number().int().positive(),
  since: z.string().min(1),
  until: z.string().min(1),
  commitCount: z.number().int().nonnegative(),
  touchedPaths: z.number().int().nonnegative(),
  highestChurn: z.array(HotspotItemSchema),
  mostActive: z.array(HotspotItemSchema),
  hints: z.array(z.string().min(1)),
});

export const ProvHotspotsDataSchema = z.object({
  anchor: HotspotAnchorSchema,
  repo: ProvRepoStateDataSchema,
  history: HistorySummarySchema,
  windows: z.array(HotspotWindowSchema),
});

export const ProvHotspotsResultSchema = createProvenanceResultSchema(ProvHotspotsDataSchema);

const AuthorityTotalsSchema = z.object({
  commits: z.number().int().nonnegative(),
  touchedPaths: z.number().int().nonnegative(),
  uniqueAuthors: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
});

const AuthorityAuthorSchema = z.object({
  authorName: z.string().min(1),
  authorEmail: z.string().email(),
  commits: z.number().int().nonnegative(),
  uniquePaths: z.number().int().nonnegative(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  churn: z.number().int().nonnegative(),
  lastTouchedAt: z.string().nullable(),
  score: ExplainableScoreSchema,
});

export const ProvAuthorityDataSchema = z.object({
  anchor: z.object({
    requestedPath: z.string().min(1),
    resolvedPath: z.string().min(1),
  }),
  repo: ProvRepoStateDataSchema,
  history: HistorySummarySchema,
  window: z.object({
    days: z.number().int().positive(),
    since: z.string().min(1),
    until: z.string().min(1),
  }),
  totals: AuthorityTotalsSchema,
  leaders: z.array(AuthorityAuthorSchema),
});

export const ProvAuthorityResultSchema = createProvenanceResultSchema(ProvAuthorityDataSchema);

const StabilityEvidenceSchema = z.object({
  sources: z.object({
    messages: EvidenceSourceSummarySchema,
    workItems: EvidenceSourceSummarySchema,
    traces: EvidenceSourceSummarySchema,
  }),
  rankedItems: z.number().int().nonnegative(),
  bounds: ProvenanceBoundsSchema,
  bytes: ProvenanceBoundsSchema,
  hints: z.array(z.string().min(1)),
});

const StabilityAssessmentSchema = z.object({
  label: z.enum(["steady", "watch", "volatile"]),
  reasons: z.array(z.string().min(1)),
});

export const ProvStabilityReportDataSchema = z.object({
  anchor: z.object({
    requestedPath: z.string().min(1),
    resolvedPath: z.string().min(1),
  }),
  repo: ProvRepoStateDataSchema,
  history: HistorySummarySchema,
  windows: z.object({
    recent: z.object({
      days: z.number().int().positive(),
      since: z.string().min(1),
      until: z.string().min(1),
      commits: z.number().int().nonnegative(),
    }),
    baseline: z.object({
      days: z.number().int().positive(),
      since: z.string().min(1),
      until: z.string().min(1),
      commits: z.number().int().nonnegative(),
      touchedPaths: z.number().int().nonnegative(),
      uniqueAuthors: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      churn: z.number().int().nonnegative(),
      lastTouchedAt: z.string().nullable(),
    }),
  }),
  pending: z.object({
    staged: z.number().int().nonnegative(),
    unstaged: z.number().int().nonnegative(),
    untracked: z.number().int().nonnegative(),
    totalPaths: z.number().int().nonnegative(),
  }),
  evidence: StabilityEvidenceSchema,
  scores: z.object({
    stability: ExplainableScoreSchema,
    ownershipClarity: ExplainableScoreSchema,
    recentChangePressure: ExplainableScoreSchema,
    pendingChangePressure: ExplainableScoreSchema,
    evidenceCoverage: ExplainableScoreSchema,
  }),
  assessment: StabilityAssessmentSchema,
});

export const ProvStabilityReportResultSchema = createProvenanceResultSchema(
  ProvStabilityReportDataSchema,
);

type ProvenanceSignal = z.infer<typeof ProvenanceSignalSchema>;
type ProvenanceScoreFactor = z.infer<typeof ProvenanceScoreFactorSchema>;
type ExplainableScore = z.infer<typeof ExplainableScoreSchema>;
type HotspotItem = z.infer<typeof HotspotItemSchema>;
type HotspotWindow = z.infer<typeof HotspotWindowSchema>;
type EvidenceSummary = z.infer<typeof StabilityEvidenceSchema>;
type HistorySummary = z.infer<typeof HistorySummarySchema>;

type HistoryChange = {
  path: string;
  additions: number;
  deletions: number;
  churn: number;
};

type HistoryCommit = {
  commit: string;
  authoredAt: string;
  authoredAtMs: number;
  authorName: string;
  authorEmail: string;
  summary: string;
  changes: HistoryChange[];
};

type LoadedHistory = {
  headCommit: string | null;
  headAuthoredAt: string | null;
  headAuthoredAtMs: number | null;
  oldestSince: string | null;
  totalCommits: number;
  commits: HistoryCommit[];
  bounds: HistorySummary["bounds"];
  detectionMethod: string;
  warnings: ProvenanceWarning[];
};

type MutablePathStats = {
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

type AuthorStats = {
  authorName: string;
  authorEmail: string;
  commits: number;
  uniquePaths: Set<string>;
  additions: number;
  deletions: number;
  churn: number;
  lastTouchedAt: string | null;
};

type WindowAggregate = {
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

type StabilityWindows = {
  recentWindowDays: number;
  baselineWindowDays: number;
};

type StabilityWindowAggregates = {
  historySummary: HistorySummary;
  recentSince: string;
  baselineSince: string;
  recentAggregate: WindowAggregate;
  baselineAggregate: WindowAggregate;
};

type StabilityPendingPaths = {
  pendingPaths: {
    staged: Set<string>;
    unstaged: Set<string>;
    untracked: Set<string>;
  };
  allPending: Set<string>;
};

type HotspotsToolInput = {
  path?: string;
  windows?: number[];
  group_by?: "file" | "directory";
  directory_depth?: number;
  limit?: number;
  max_commits?: number;
  mode?: "local" | "remote" | "hybrid";
};

type StabilityReportToolInput = {
  path?: string;
  recent_window_days?: number;
  baseline_window_days?: number;
  limit?: number;
  max_commits?: number;
  mode?: "local" | "remote" | "hybrid";
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function toPercent(value: number): number {
  return round(clamp(value, 0, 1) * 100);
}

function getLowestConfidence(confidences: readonly ProvenanceConfidence[]): ProvenanceConfidence {
  const priority: Record<ProvenanceConfidence, number> = {
    unknown: 0,
    low: 1,
    medium: 2,
    high: 3,
  };

  let lowest: ProvenanceConfidence = "high";
  for (const confidence of confidences) {
    if (priority[confidence] < priority[lowest]) {
      lowest = confidence;
    }
  }
  return lowest;
}

function getHighestAmbiguity(levels: readonly ProvenanceAmbiguity[]): ProvenanceAmbiguity {
  const priority: Record<ProvenanceAmbiguity, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };

  let highest: ProvenanceAmbiguity = "none";
  for (const level of levels) {
    if (priority[level] > priority[highest]) {
      highest = level;
    }
  }
  return highest;
}

function dedupeWarnings(warnings: readonly ProvenanceWarning[]): ProvenanceWarning[] {
  const seen = new Set<string>();
  const output: ProvenanceWarning[] = [];

  for (const warning of warnings) {
    const key = `${warning.code}:${warning.message}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(warning);
  }

  return output;
}

function dedupeSources(sources: readonly ProvenanceEvidenceSource[]): ProvenanceEvidenceSource[] {
  const seen = new Set<string>();
  const output: ProvenanceEvidenceSource[] = [];

  for (const source of sources) {
    const key = `${source.kind}:${source.id}:${source.path ?? ""}:${source.ref ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(source);
  }

  return output;
}

function dedupeSignals(signals: readonly ProvenanceSignal[]): ProvenanceSignal[] {
  const seen = new Set<string>();
  const output: ProvenanceSignal[] = [];

  for (const signal of signals) {
    const key = `${signal.key}:${String(signal.value)}:${signal.sourceIDs.join(",")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(signal);
  }

  return output;
}

function createUnsupportedModeFailure(
  toolName:
    | typeof GW_HOTSPOTS_TOOL
    | typeof GW_AUTHORITY_TOOL
    | typeof GW_STABILITY_REPORT_TOOL,
  mode: string,
): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: toolName,
      mode: mode as "remote" | "hybrid",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Unsupported provenance mode '${mode}' for ${toolName}.`,
      error: {
        code: "MODE_NOT_SUPPORTED",
        message: `${toolName} currently supports only local mode.`,
      },
    }),
    null,
    2,
  );
}

function createToolFailure(
  toolName:
    | typeof GW_HOTSPOTS_TOOL
    | typeof GW_AUTHORITY_TOOL
    | typeof GW_STABILITY_REPORT_TOOL,
  summary: string,
  code: string,
  message: string,
): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: toolName,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary,
      error: {
        code,
        message,
      },
    }),
    null,
    2,
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTimestamp(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeAnalysisPath(requestedPath: string | undefined, rootDir?: string): string {
  const normalized = normalizeRequestedPath(requestedPath?.trim() || ".", rootDir);
  return normalized || ".";
}

function normalizeWindowDays(
  requested: number[] | undefined,
  fallback: readonly number[],
): number[] {
  const values = requested && requested.length > 0 ? requested : [...fallback];
  return [...new Set(values.map((value) => Math.trunc(value)).filter((value) => value > 0))].sort(
    (left, right) => left - right,
  );
}

function normalizeHistoryPath(rawPath: string): string {
  const normalized = rawPath.trim().replace(/\\/g, "/");
  const bracePattern = /^(.*)\{(.+?) => (.+?)\}(.*)$/;
  const braceMatch = normalized.match(bracePattern);
  if (braceMatch) {
    return `${braceMatch[1]}${braceMatch[3]}${braceMatch[4]}`.replace(/\/+/g, "/");
  }

  if (normalized.includes(" => ")) {
    return normalized.split(" => ").at(-1)?.trim() ?? normalized;
  }

  return normalized;
}

function isPathWithinAnchor(targetPath: string, anchorPath: string): boolean {
  if (anchorPath === ".") {
    return true;
  }

  return targetPath === anchorPath || targetPath.startsWith(`${anchorPath}/`);
}

function collectStatusPaths(entry: LocalRepoFileStatus, anchorPath: string): string[] {
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

function createSignal(options: {
  key: string;
  label: string;
  value: string | number | boolean;
  sourceIDs: string[];
  unit?: string;
  detail?: string;
}): ProvenanceSignal {
  return {
    key: options.key,
    label: options.label,
    value: options.value,
    unit: options.unit,
    detail: options.detail,
    sourceIDs: options.sourceIDs,
  };
}

function createScore(options: {
  key: string;
  label: string;
  formula: string;
  interpretation: string;
  factors: ProvenanceScoreFactor[];
}): ExplainableScore {
  const value = round(options.factors.reduce((sum, factor) => sum + factor.contribution, 0));
  return {
    key: options.key,
    label: options.label,
    value,
    scale: {
      min: 0,
      max: 100,
      unit: "points",
    },
    formula: options.formula,
    interpretation: options.interpretation,
    factors: options.factors,
    signals: dedupeSignals(options.factors.flatMap((factor) => factor.signals)),
  };
}

function shareFactor(options: {
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  numeratorLabel: string;
  denominatorLabel: string;
  weight: number;
  sourceIDs: string[];
  unit?: string;
  detail?: string;
}): ProvenanceScoreFactor {
  const ratio = options.denominator > 0 ? options.numerator / options.denominator : 0;
  const value = toPercent(ratio);
  const contribution = round(value * options.weight);

  return {
    key: options.key,
    label: options.label,
    weight: options.weight,
    value,
    contribution,
    explanation: `${options.label} uses ${options.numerator}/${options.denominator} observed signal(s).`,
    signals: [
      createSignal({
        key: `${options.key}_numerator`,
        label: options.numeratorLabel,
        value: options.numerator,
        unit: options.unit,
        detail: options.detail,
        sourceIDs: options.sourceIDs,
      }),
      createSignal({
        key: `${options.key}_denominator`,
        label: options.denominatorLabel,
        value: options.denominator,
        unit: options.unit,
        sourceIDs: options.sourceIDs,
      }),
    ],
  };
}

function describeAuthority(score: number): string {
  if (score >= 70) {
    return "dominant recent authority";
  }
  if (score >= 45) {
    return "shared authority";
  }
  return "light recent authority";
}

function describeOwnershipClarity(score: number): string {
  if (score >= 70) {
    return "changes are concentrated under one recent steward";
  }
  if (score >= 40) {
    return "ownership is shared across a few recent authors";
  }
  return "ownership is diffuse in the recent window";
}

function describePressure(score: number, positiveLabel: string, neutralLabel: string): string {
  if (score >= 70) {
    return positiveLabel;
  }
  if (score >= 35) {
    return neutralLabel;
  }
  return "pressure is low";
}

function describeCoverage(score: number): string {
  if (score >= 70) {
    return "local evidence covers most recent commits";
  }
  if (score >= 35) {
    return "local evidence covers part of the recent activity";
  }
  return "recent activity has little linked local evidence";
}

function buildRepoSources(
  repo: z.infer<typeof ProvRepoStateDataSchema>,
): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: "branch",
      ref: repo.branch.ref ?? "HEAD",
      label: repo.branch.name ?? "detached HEAD",
      detail: repo.branch.detectionMethod,
    },
    {
      kind: "git",
      id: "base",
      ref: repo.base.ref ?? repo.base.detectionKind,
      label: "base",
      detail: repo.base.detectionMethod,
    },
    {
      kind: "git",
      id: "HEAD",
      ref: repo.head.ref,
      label: repo.head.branchName ?? "detached HEAD",
      detail: repo.head.shortCommit ?? "HEAD unavailable",
    },
    {
      kind: "git",
      id: "index",
      ref: repo.staged.ref,
      label: "staged",
      detail: `${repo.staged.count} file(s)`,
    },
    {
      kind: "git",
      id: "worktree",
      ref: repo.unstaged.ref,
      label: "unstaged",
      detail: `${repo.unstaged.count} file(s)`,
    },
    {
      kind: "git",
      id: "untracked",
      ref: repo.untracked.ref,
      label: "untracked",
      detail: `${repo.untracked.count} file(s)`,
    },
  ];

  return dedupeSources(sources);
}

function buildHistorySource(options: {
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

function summarizeEvidenceSource<TItem extends LocalEvidenceMatch>(
  source: LocalEvidenceSourceResult<TItem>,
): z.infer<typeof EvidenceSourceSummarySchema> {
  switch (source.status) {
    case "available":
      return {
        status: "available",
        totalMatches: source.totalMatches,
        bounds: source.bounds,
        warnings: source.warnings,
      };
    case "unavailable":
      return {
        status: "unavailable",
        code: source.code,
        message: source.message,
      };
    case "unsupported":
      return {
        status: "unsupported",
        code: source.code,
        message: source.message,
      };
  }
}

function buildEvidenceSummary(
  evidence: Awaited<ReturnType<typeof loadLocalPathEvidence>>,
): EvidenceSummary {
  const summary: EvidenceSummary = {
    sources: {
      messages: summarizeEvidenceSource(evidence.sources.messages),
      workItems: summarizeEvidenceSource(evidence.sources.workItems),
      traces: summarizeEvidenceSource(evidence.sources.traces),
    },
    rankedItems: evidence.ranked.items.length,
    bounds: evidence.ranked.bounds,
    bytes: evidence.ranked.bytes,
    hints: [],
  };

  if (
    summary.sources.messages.status === "available" &&
    summary.sources.messages.bounds.truncated
  ) {
    summary.hints.push("Message evidence was truncated by the per-source limit.");
  }
  if (
    summary.sources.workItems.status === "available" &&
    summary.sources.workItems.bounds.truncated
  ) {
    summary.hints.push("Work-item evidence was truncated by the per-source limit.");
  }
  if (summary.sources.traces.status === "available" && summary.sources.traces.bounds.truncated) {
    summary.hints.push("Trace evidence was truncated by the per-source limit.");
  }
  if (summary.bounds.truncated) {
    summary.hints.push("Ranked evidence was truncated by the item limit.");
  }
  if (summary.bytes.truncated) {
    summary.hints.push(`Ranked evidence hit the ${summary.bytes.limit}-byte budget.`);
  }

  return summary;
}

function toEvidenceWarnings(summary: EvidenceSummary): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [];

  for (const source of [
    summary.sources.messages,
    summary.sources.workItems,
    summary.sources.traces,
  ]) {
    if (source.status === "available") {
      warnings.push(...source.warnings);
      if (source.bounds.truncated) {
        warnings.push({
          code: "EVIDENCE_SOURCE_TRUNCATED",
          message: "A linked evidence source was truncated by the per-source limit.",
          ambiguity: "low",
        });
      }
    }
  }

  if (summary.bounds.truncated) {
    warnings.push({
      code: "EVIDENCE_ITEMS_TRUNCATED",
      message: `Ranked evidence was truncated to ${summary.bounds.returned} item(s).`,
      ambiguity: "low",
    });
  }

  if (summary.bytes.truncated) {
    warnings.push({
      code: "EVIDENCE_BYTES_TRUNCATED",
      message: `Ranked evidence hit the ${summary.bytes.limit}-byte budget.`,
      ambiguity: "low",
    });
  }

  return warnings;
}

function toRepoAmbiguityWarnings(
  repo: z.infer<typeof ProvRepoStateDataSchema>,
): ProvenanceWarning[] {
  return repo.ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
}

function parseHistoryLog(raw: string): HistoryCommit[] {
  const commits: HistoryCommit[] = [];
  let current: HistoryCommit | null = null;

  const pushCurrent = () => {
    if (current) {
      commits.push(current);
      current = null;
    }
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const commitParts = trimmed.split("\u001f");
    if (commitParts.length >= 5) {
      pushCurrent();
      const [commit, authoredAt, authorName, authorEmail, ...summaryParts] = commitParts;
      const authoredAtMs = parseTimestamp(authoredAt);
      if (!commit || !authoredAt || !authorName || !authorEmail || authoredAtMs === null) {
        continue;
      }

      current = {
        commit,
        authoredAt,
        authoredAtMs,
        authorName,
        authorEmail,
        summary: summaryParts.join("\u001f") || "(no summary)",
        changes: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const [additionsRaw, deletionsRaw, ...pathParts] = line.split("\t");
    if (!additionsRaw || !deletionsRaw || pathParts.length === 0) {
      continue;
    }

    const additions = additionsRaw === "-" ? 0 : Number.parseInt(additionsRaw, 10) || 0;
    const deletions = deletionsRaw === "-" ? 0 : Number.parseInt(deletionsRaw, 10) || 0;
    const normalizedPath = normalizeHistoryPath(pathParts.join("\t"));
    current.changes.push({
      path: normalizedPath,
      additions,
      deletions,
      churn: additions + deletions,
    });
  }

  pushCurrent();
  return commits;
}

async function loadHistory(options: {
  shell: CreateStateToolsOptions["shell"];
  resolvedPath: string;
  windowDays: number[];
  maxCommits: number | undefined;
}): Promise<LoadedHistory> {
  const requestedMaxCommits = options.maxCommits;
  const boundedMaxCommits = resolveBoundedNumber(requestedMaxCommits, HISTORY_COMMIT_LIMIT_OPTIONS);
  const largestWindow =
    options.windowDays[options.windowDays.length - 1] ?? DEFAULT_AUTHORITY_WINDOW_DAYS;
  const pathSpec = options.resolvedPath === "." ? "." : options.resolvedPath;
  const headRaw = await runProcessText({
    shell: options.shell,
    cmd: ["git", "log", "-1", `--format=%H%x1f%aI`, "HEAD"],
    maxOutputBytes: historyParseMaxOutputBytes,
    trim: false,
  });
  const [headCommit, headAuthoredAt] = headRaw.trim().split("\u001f");
  const headAuthoredAtMs = parseTimestamp(headAuthoredAt);

  if (!headCommit || !headAuthoredAt || headAuthoredAtMs === null) {
    return {
      headCommit: null,
      headAuthoredAt: null,
      headAuthoredAtMs: null,
      oldestSince: null,
      totalCommits: 0,
      commits: [],
      bounds: {
        requested: requestedMaxCommits,
        limit: boundedMaxCommits,
        returned: 0,
        truncated: false,
      },
      detectionMethod: `${HISTORY_HEAD_ANCHOR_METHOD} + ${HISTORY_DETECTION_METHOD}`,
      warnings: [
        {
          code: "HEAD_HISTORY_UNAVAILABLE",
          message: "HEAD commit timestamp could not be resolved for history windows.",
          ambiguity: "medium",
        },
      ],
    };
  }

  const oldestSince = new Date(headAuthoredAtMs - largestWindow * DAY_MS).toISOString();
  const [countRaw, logRaw] = await Promise.all([
    runProcessText({
      shell: options.shell,
      cmd: [
        "git",
        "rev-list",
        "--count",
        "--no-merges",
        `--since=${oldestSince}`,
        "HEAD",
        "--",
        pathSpec,
      ],
      maxOutputBytes: historyParseMaxOutputBytes,
      trim: false,
    }),
    runProcessText({
      shell: options.shell,
      cmd: [
        "git",
        "log",
        "--find-renames",
        "--no-merges",
        "--numstat",
        "-n",
        String(boundedMaxCommits),
        `--since=${oldestSince}`,
        `--format=%H%x1f%aI%x1f%an%x1f%ae%x1f%s`,
        "HEAD",
        "--",
        pathSpec,
      ],
      maxOutputBytes: historyParseMaxOutputBytes,
      trim: false,
    }),
  ]);

  const totalCommits = Number.parseInt(countRaw.trim() || "0", 10) || 0;
  const commits = parseHistoryLog(logRaw);
  const warnings: ProvenanceWarning[] = [];
  if (totalCommits > commits.length) {
    warnings.push({
      code: "HISTORY_COMMITS_TRUNCATED",
      message: `History scan loaded ${commits.length}/${totalCommits} commit(s); rerun with a larger max_commits to inspect more.`,
      ambiguity: "low",
    });
  }
  if (totalCommits === 0) {
    warnings.push({
      code: "HISTORY_EMPTY",
      message: `No matching non-merge commits were found for '${options.resolvedPath}' in the requested window.`,
      ambiguity: "low",
    });
  }

  return {
    headCommit,
    headAuthoredAt,
    headAuthoredAtMs,
    oldestSince,
    totalCommits,
    commits,
    bounds: {
      requested: requestedMaxCommits,
      limit: boundedMaxCommits,
      returned: commits.length,
      truncated: totalCommits > commits.length,
    },
    detectionMethod: `${HISTORY_HEAD_ANCHOR_METHOD} + ${HISTORY_DETECTION_METHOD}`,
    warnings,
  };
}

function filterHistoryByWindow(
  commits: readonly HistoryCommit[],
  sinceTimestamp: number,
): HistoryCommit[] {
  return commits.filter((commit) => commit.authoredAtMs >= sinceTimestamp);
}

function aggregateWindow(options: {
  commits: readonly HistoryCommit[];
  anchorPath: string;
  groupBy: "file" | "directory";
  directoryDepth: number;
}): WindowAggregate {
  const pathStats = new Map<string, MutablePathStats>();
  const authorStats = new Map<string, AuthorStats>();
  const uniqueAuthors = new Set<string>();
  const rawTouchedPaths = new Set<string>();
  let additions = 0;
  let deletions = 0;
  let lastTouchedAt: string | null = null;

  for (const commit of options.commits) {
    const perCommitGrouped = new Map<
      string,
      { additions: number; deletions: number; churn: number }
    >();
    const perCommitRawPaths = new Set<string>();
    const authorKey = `${commit.authorName}<${commit.authorEmail}>`;
    uniqueAuthors.add(authorKey);

    for (const change of commit.changes) {
      rawTouchedPaths.add(change.path);
      perCommitRawPaths.add(change.path);
      additions += change.additions;
      deletions += change.deletions;

      const key =
        options.groupBy === "file"
          ? change.path
          : getDirectoryGroupKey(change.path, options.anchorPath, options.directoryDepth);
      const existing = perCommitGrouped.get(key) ?? { additions: 0, deletions: 0, churn: 0 };
      existing.additions += change.additions;
      existing.deletions += change.deletions;
      existing.churn += change.churn;
      perCommitGrouped.set(key, existing);
    }

    if (commit.authoredAt && (!lastTouchedAt || commit.authoredAt > lastTouchedAt)) {
      lastTouchedAt = commit.authoredAt;
    }

    const author = authorStats.get(authorKey) ?? {
      authorName: commit.authorName,
      authorEmail: commit.authorEmail,
      commits: 0,
      uniquePaths: new Set<string>(),
      additions: 0,
      deletions: 0,
      churn: 0,
      lastTouchedAt: null,
    };
    author.commits += 1;
    for (const rawPath of perCommitRawPaths) {
      author.uniquePaths.add(rawPath);
    }
    for (const change of commit.changes) {
      author.additions += change.additions;
      author.deletions += change.deletions;
      author.churn += change.churn;
    }
    if (!author.lastTouchedAt || commit.authoredAt > author.lastTouchedAt) {
      author.lastTouchedAt = commit.authoredAt;
    }
    authorStats.set(authorKey, author);

    for (const [key, metrics] of perCommitGrouped.entries()) {
      const stats = pathStats.get(key) ?? {
        path: key,
        commitCount: 0,
        additions: 0,
        deletions: 0,
        churn: 0,
        lastTouchedAt: null,
        authors: new Set<string>(),
        authorMetadata: new Map<string, { authorName: string; authorEmail: string }>(),
        authorCommitCounts: new Map<string, number>(),
      };
      stats.commitCount += 1;
      stats.additions += metrics.additions;
      stats.deletions += metrics.deletions;
      stats.churn += metrics.churn;
      stats.authors.add(authorKey);
      stats.authorMetadata.set(authorKey, {
        authorName: commit.authorName,
        authorEmail: commit.authorEmail,
      });
      stats.authorCommitCounts.set(authorKey, (stats.authorCommitCounts.get(authorKey) ?? 0) + 1);
      if (!stats.lastTouchedAt || commit.authoredAt > stats.lastTouchedAt) {
        stats.lastTouchedAt = commit.authoredAt;
      }
      pathStats.set(key, stats);
    }
  }

  return {
    commits: options.commits.length,
    touchedPaths: pathStats.size,
    additions,
    deletions,
    churn: additions + deletions,
    uniqueAuthors: uniqueAuthors.size,
    lastTouchedAt,
    pathStats: [...pathStats.values()],
    authorStats: [...authorStats.values()],
    rawTouchedPaths: rawTouchedPaths.size,
  };
}

function compareHotspotByActivity(left: MutablePathStats, right: MutablePathStats): number {
  if (right.commitCount !== left.commitCount) {
    return right.commitCount - left.commitCount;
  }
  if (right.churn !== left.churn) {
    return right.churn - left.churn;
  }
  return left.path.localeCompare(right.path);
}

function compareHotspotByChurn(left: MutablePathStats, right: MutablePathStats): number {
  if (right.churn !== left.churn) {
    return right.churn - left.churn;
  }
  if (right.commitCount !== left.commitCount) {
    return right.commitCount - left.commitCount;
  }
  return left.path.localeCompare(right.path);
}

function compareAuthors(
  left: z.infer<typeof AuthorityAuthorSchema>,
  right: z.infer<typeof AuthorityAuthorSchema>,
): number {
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

function toSampleAuthors(stats: MutablePathStats): z.infer<typeof AuthorSampleSchema>[] {
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

function toHotspotItem(stats: MutablePathStats, historySourceID: string): HotspotItem {
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

function buildHotspotWindows(options: {
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

function buildAuthorityScore(options: {
  author: AuthorStats;
  totals: z.infer<typeof AuthorityTotalsSchema>;
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

function buildAssessment(
  scores: z.infer<typeof ProvStabilityReportDataSchema>["scores"],
): z.infer<typeof StabilityAssessmentSchema> {
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
  if (scores.evidenceCoverage.value >= 70) {
    reasons.push("local evidence covers most of the recent commit activity");
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
      reasons.length > 0 ? reasons : ["signals are mixed across recency, ownership, and evidence"],
  };
}

function buildHistorySummary(history: LoadedHistory): HistorySummary {
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

function buildAnalysisHistorySourceID(
  analysis: "hotspots" | "authority" | "stability",
  resolvedPath: string,
): string {
  return `${analysis}-history:${resolvedPath}`;
}

function toLoadedHistoryFromSummary(history: HistorySummary): LoadedHistory {
  return {
    headCommit: history.headCommit,
    headAuthoredAt: history.headAuthoredAt,
    headAuthoredAtMs: history.headAuthoredAtMs,
    oldestSince: history.oldestSince,
    totalCommits: history.totalCommits,
    commits: [],
    bounds: history.bounds,
    detectionMethod: history.detectionMethod,
    warnings: [],
  };
}

function inferHistoryConfidence(history: LoadedHistory): ProvenanceConfidence {
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

async function executeHotspots(
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

async function executeAuthority(
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

  const totals = {
    commits: aggregate.commits,
    touchedPaths: aggregate.rawTouchedPaths,
    uniqueAuthors: aggregate.uniqueAuthors,
    additions: aggregate.additions,
    deletions: aggregate.deletions,
    churn: aggregate.churn,
  } satisfies z.infer<typeof AuthorityTotalsSchema>;

  const leaders = aggregate.authorStats
    .map((author) => {
      const score = buildAuthorityScore({
        author,
        totals,
        historySourceID,
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
    .slice(0, limit);

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

async function executeStabilityReport(
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
  evidenceResult: Awaited<ReturnType<typeof loadLocalPathEvidence>>;
  historySourceID: string;
}> {
  const resolvedPath = normalizeAnalysisPath(args.path, options.rootDir);
  const requestedPath = args.path?.trim() || ".";
  const limit = resolveBoundedNumber(args.limit, ANALYSIS_LIMIT_OPTIONS);
  const windows = resolveStabilityWindows(args);
  const [repoState, history, evidenceResult] = await Promise.all([
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
    loadLocalPathEvidence({
      rootDir: options.rootDir ?? process.cwd(),
      path: resolvedPath,
      perSourceLimit: limit,
      maxItems: limit,
    }),
  ]);

  const repo = toProvRepoStateData(repoState, limit);
  const historySourceID = buildAnalysisHistorySourceID("stability", resolvedPath);
  const evidenceSourceID = `evidence:${resolvedPath}`;
  const aggregates = buildStabilityWindowAggregates({ history, resolvedPath, windows });
  const pending = collectStabilityPendingPaths(repoState, resolvedPath);
  const evidence = buildEvidenceSummary(evidenceResult);
  const scores = buildStabilityScores({
    baselineAggregate: aggregates.baselineAggregate,
    recentAggregate: aggregates.recentAggregate,
    windows,
    pendingCount: pending.allPending.size,
    evidence,
    historySourceID,
    evidenceSourceID,
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
      evidence,
      scores,
    }),
    evidenceResult,
    historySourceID,
  };
}

function resolveStabilityWindows(args: {
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

function buildStabilityWindowAggregates(options: {
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

function collectStabilityPendingPaths(
  repoState: Awaited<ReturnType<typeof resolveLocalRepoState>>,
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

function buildOwnershipClarityScore(options: {
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

function buildRecentChangePressureScore(options: {
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

function buildPendingChangePressureScore(options: {
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

function buildEvidenceCoverageScore(options: {
  baselineAggregate: WindowAggregate;
  evidence: EvidenceSummary;
  evidenceSourceID: string;
}): ExplainableScore {
  return createScore({
    key: "evidence_coverage",
    label: "Evidence coverage",
    formula: "100 * min(1, linked_evidence_items / max(1, baseline_commits))",
    interpretation: describeCoverage(
      toPercent(
        Math.min(1, options.evidence.rankedItems / Math.max(1, options.baselineAggregate.commits)),
      ),
    ),
    factors: [
      shareFactor({
        key: "linked_evidence_share",
        label: "Linked evidence per baseline commit",
        numerator: Math.min(
          options.evidence.rankedItems,
          Math.max(1, options.baselineAggregate.commits),
        ),
        denominator: Math.max(1, options.baselineAggregate.commits),
        numeratorLabel: "Linked evidence items",
        denominatorLabel: "Baseline commits",
        weight: 1,
        sourceIDs: [options.evidenceSourceID],
        unit: "items",
      }),
    ],
  });
}

function buildCompositeStabilityScore(scores: {
  ownershipClarity: ExplainableScore;
  evidenceCoverage: ExplainableScore;
  recentChangePressure: ExplainableScore;
  pendingChangePressure: ExplainableScore;
}): ExplainableScore {
  return createScore({
    key: "stability",
    label: "Stability",
    formula:
      "(ownership_clarity + evidence_coverage + (100 - recent_change_pressure) + (100 - pending_change_pressure)) / 4",
    interpretation: "watch",
    factors: [
      {
        key: "ownership_clarity_factor",
        label: "Ownership clarity",
        weight: 0.25,
        value: scores.ownershipClarity.value,
        contribution: round(scores.ownershipClarity.value * 0.25),
        explanation: "Higher recent ownership clarity improves stability.",
        signals: scores.ownershipClarity.signals,
      },
      {
        key: "evidence_coverage_factor",
        label: "Evidence coverage",
        weight: 0.25,
        value: scores.evidenceCoverage.value,
        contribution: round(scores.evidenceCoverage.value * 0.25),
        explanation: "More linked local evidence improves explainability and stability.",
        signals: scores.evidenceCoverage.signals,
      },
      {
        key: "change_calmness_factor",
        label: "Change calmness",
        weight: 0.25,
        value: round(100 - scores.recentChangePressure.value),
        contribution: round((100 - scores.recentChangePressure.value) * 0.25),
        explanation: "Less short-window concentration improves stability.",
        signals: scores.recentChangePressure.signals,
      },
      {
        key: "clean_worktree_factor",
        label: "Clean worktree",
        weight: 0.25,
        value: round(100 - scores.pendingChangePressure.value),
        contribution: round((100 - scores.pendingChangePressure.value) * 0.25),
        explanation: "Fewer pending changes on recently touched paths improves stability.",
        signals: scores.pendingChangePressure.signals,
      },
    ],
  });
}

function interpretStabilityScore(value: number): string {
  return value >= 70
    ? "steady recent history"
    : value >= 45
      ? "mixed recent stability"
      : "fragile recent stability";
}

function buildStabilityScores(options: {
  baselineAggregate: WindowAggregate;
  recentAggregate: WindowAggregate;
  windows: StabilityWindows;
  pendingCount: number;
  evidence: EvidenceSummary;
  historySourceID: string;
  evidenceSourceID: string;
}): z.infer<typeof ProvStabilityReportDataSchema>["scores"] {
  const ownershipClarity = buildOwnershipClarityScore(options);
  const recentChangePressure = buildRecentChangePressureScore(options);
  const pendingChangePressure = buildPendingChangePressureScore(options);
  const evidenceCoverage = buildEvidenceCoverageScore(options);
  const stability = buildCompositeStabilityScore({
    ownershipClarity,
    evidenceCoverage,
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
    evidenceCoverage,
  };
}

function buildStabilityReportData(options: {
  requestedPath: string;
  resolvedPath: string;
  repo: z.infer<typeof ProvRepoStateDataSchema>;
  history: LoadedHistory;
  windows: StabilityWindows;
  aggregates: StabilityWindowAggregates;
  pending: StabilityPendingPaths;
  evidence: EvidenceSummary;
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
    evidence: options.evidence,
    scores: options.scores,
    assessment: buildAssessment(options.scores),
  };
}

function buildHotspotsSummary(data: z.infer<typeof ProvHotspotsDataSchema>): string {
  const latestWindow = data.windows.at(-1);
  const topActive = latestWindow?.mostActive[0];
  const topChurn = latestWindow?.highestChurn[0];
  if (!latestWindow) {
    return `Hotspots for ${data.anchor.resolvedPath}: no history windows were available.`;
  }

  return `Hotspots for ${data.anchor.resolvedPath}: ${latestWindow.days}d top activity ${topActive?.path ?? "none"} (${topActive?.commitCount ?? 0} commit(s)), top churn ${topChurn?.path ?? "none"} (${topChurn?.churn ?? 0} changed line(s)).`;
}

function buildAuthoritySummary(data: z.infer<typeof ProvAuthorityDataSchema>): string {
  const leader = data.leaders[0];
  if (!leader) {
    return `Authority for ${data.anchor.resolvedPath}: no recent authors were found in the ${data.window.days}d window.`;
  }

  return `Authority for ${data.anchor.resolvedPath}: ${leader.authorName} leads with ${leader.score.value}/100 from ${leader.commits}/${Math.max(data.totals.commits, 1)} commit(s) in the ${data.window.days}d window.`;
}

function buildStabilitySummary(data: z.infer<typeof ProvStabilityReportDataSchema>): string {
  return `Stability for ${data.anchor.resolvedPath}: ${data.scores.stability.value}/100 (${data.assessment.label}), recent pressure ${data.scores.recentChangePressure.value}, pending pressure ${data.scores.pendingChangePressure.value}.`;
}

export function createScoreTools(options: CreateStateToolsOptions): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [GW_HOTSPOTS_TOOL]: createHotspotsTool(runtimeOptions),
    [GW_AUTHORITY_TOOL]: createAuthorityTool(runtimeOptions),
    [GW_STABILITY_REPORT_TOOL]: createStabilityReportTool(runtimeOptions),
  };
}

function createHotspotsTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
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
    ...(data.history.bounds.truncated
      ? [
          {
            code: "HISTORY_COMMITS_TRUNCATED",
            message: `History scan loaded ${data.history.loadedCommits}/${data.history.totalCommits} commit(s).`,
            ambiguity: "low" as const,
          },
        ]
      : []),
    ...(data.history.totalCommits === 0
      ? [
          {
            code: "HISTORY_EMPTY",
            message: `No matching non-merge commits were found for '${data.anchor.resolvedPath}' in the requested window.`,
            ambiguity: "low" as const,
          },
        ]
      : []),
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
  return createToolFailure(
    GW_HOTSPOTS_TOOL,
    `Failed to resolve hotspots for '${args.path ?? "."}'.`,
    "HOTSPOTS_UNAVAILABLE",
    message,
  );
}

function createAuthorityTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
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
    async execute(args) {
      const mode = args.mode ?? "local";
      if (mode !== "local") {
        logger.warn("gw_authority unsupported mode", { tool: GW_AUTHORITY_TOOL, mode });
        return createUnsupportedModeFailure(GW_AUTHORITY_TOOL, mode);
      }

      logger.info("gw_authority start", {
        tool: GW_AUTHORITY_TOOL,
        path: args.path ?? ".",
        windowDays: args.window_days,
        limit: args.limit,
        maxCommits: args.max_commits,
      });

      try {
        const data = await executeAuthority(runtimeOptions, args);
        const historySourceID = buildAnalysisHistorySourceID(
          "authority",
          data.anchor.resolvedPath,
        );
        const warnings = dedupeWarnings([
          ...toRepoAmbiguityWarnings(data.repo),
          ...(data.history.bounds.truncated
            ? [
                {
                  code: "HISTORY_COMMITS_TRUNCATED",
                  message: `Authority scan loaded ${data.history.loadedCommits}/${data.history.totalCommits} commit(s).`,
                  ambiguity: "low" as const,
                },
              ]
            : []),
          ...(data.totals.commits === 0
            ? [
                {
                  code: "AUTHORITY_EMPTY",
                  message: `No recent authority signals were found for '${data.anchor.resolvedPath}'.`,
                  ambiguity: "low" as const,
                },
              ]
            : []),
        ]);
        const sources = dedupeSources([
          ...buildRepoSources(data.repo),
          buildHistorySource({
            id: historySourceID,
            resolvedPath: data.anchor.resolvedPath,
            history: toLoadedHistoryFromSummary(data.history),
          }),
        ]);
        const response = createProvenanceSuccess({
          tool: GW_AUTHORITY_TOOL,
          mode: "local",
          confidence: getLowestConfidence([
            data.repo.branch.confidence,
            data.totals.commits > 0 ? (data.history.bounds.truncated ? "medium" : "high") : "low",
          ]),
          ambiguity: getHighestAmbiguity([
            data.repo.ambiguity.level,
            ...warnings.map((warning) => warning.ambiguity ?? "low"),
          ]),
          summary: buildAuthoritySummary(data),
          warnings,
          sources,
          data,
        });

        logger.info("gw_authority end", {
          tool: GW_AUTHORITY_TOOL,
          path: data.anchor.resolvedPath,
          leaders: data.leaders.length,
          commits: data.totals.commits,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("gw_authority failed", {
          tool: GW_AUTHORITY_TOOL,
          path: args.path ?? ".",
          error: message,
        });
        return createToolFailure(
          GW_AUTHORITY_TOOL,
          `Failed to resolve authority for '${args.path ?? "."}'.`,
          "AUTHORITY_UNAVAILABLE",
          message,
        );
      }
    },
  });
}

function createStabilityReportTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
  return tool({
    description:
      "Report recent path stability with explicit component scores, factor breakdowns, pending-change pressure, and linked evidence coverage.",
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
  evidenceResult: Awaited<ReturnType<typeof loadLocalPathEvidence>>;
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
    ...(data.history.bounds.truncated
      ? [
          {
            code: "HISTORY_COMMITS_TRUNCATED",
            message: `Stability scan loaded ${data.history.loadedCommits}/${data.history.totalCommits} commit(s).`,
            ambiguity: "low" as const,
          },
        ]
      : []),
    ...(data.history.totalCommits === 0
      ? [
          {
            code: "HISTORY_EMPTY",
            message: `No matching non-merge commits were found for '${data.anchor.resolvedPath}'.`,
            ambiguity: "low" as const,
          },
        ]
      : []),
    ...toEvidenceWarnings(data.evidence),
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
  evidenceResult: Awaited<ReturnType<typeof loadLocalPathEvidence>>;
  historySourceID: string;
}): ProvenanceEvidenceSource[] {
  const data = result.data;
  const evidenceSourceID = `evidence:${data.anchor.resolvedPath}`;
  return dedupeSources([
    ...buildRepoSources(data.repo),
    buildHistorySource({
      id: result.historySourceID,
      resolvedPath: data.anchor.resolvedPath,
      history: toLoadedHistoryFromSummary(data.history),
    }),
    {
      kind: "derived",
      id: evidenceSourceID,
      path: data.anchor.resolvedPath,
      label: "linked evidence",
      detail: `${data.evidence.rankedItems} ranked item(s)`,
    },
    ...toProvenanceEvidenceSources(result.evidenceResult.ranked.items),
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
  return createToolFailure(
    GW_STABILITY_REPORT_TOOL,
    `Failed to build a stability report for '${args.path ?? "."}'.`,
    "STABILITY_REPORT_UNAVAILABLE",
    message,
  );
}
