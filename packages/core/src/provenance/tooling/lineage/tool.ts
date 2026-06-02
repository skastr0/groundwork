import { tool, type ToolDefinition } from "../tool.ts";
import { runProcessText } from "../../../shared/effect-runtime.ts";
import { z } from "zod";
import {
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
  provenanceEndLineArg,
  provenanceLimitArg,
  provenanceModeArg,
  provenancePathArg,
  provenanceStartLineArg,
} from "../args.ts";
import {
  createProvenanceFailure,
  createProvenanceResultSchema,
  createProvenanceSuccess,
  ProvenanceBoundsSchema,
  ProvenanceConfidenceSchema,
  type ProvenanceAmbiguity,
  type ProvenanceBounds,
  type ProvenanceConfidence,
  type ProvenanceEvidenceSource,
  type ProvenanceResult,
  type ProvenanceWarning,
} from "../contracts.ts";
import {
  normalizeCreateStateToolsOptions,
  normalizeRequestedPath,
  type CreateStateToolsOptions,
} from "../state/internal.ts";
import { createUnsupportedModeFailure } from "../shared.ts";
import { logger } from "../utils/logger.ts";

const GW_SPAN_HISTORY_TOOL = "gw_span_history" as const;
const LINEAGE_ENTRY_KIND_VALUES = ["commit"] as const;
const CONTRIBUTOR_TYPE_VALUES = ["human", "ai", "mixed", "unknown"] as const;
const CONTRIBUTOR_EVIDENCE_KIND_VALUES = ["git"] as const;
const GIT_RANGE_HISTORY_METHOD = "git log --no-patch -L <start>,<end>:<path>";
const GIT_RANGE_HISTORY_FORMAT = "%H%x1f%an%x1f%ae%x1f%aI%x1f%s";

const RANGE_HISTORY_PARSE_MAX_OUTPUT_BYTES = 192_000;

const AMBIGUITY_PRIORITY: Record<ProvenanceAmbiguity, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const CONFIDENCE_PRIORITY: Record<ProvenanceConfidence, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

type SpanCommitHistoryItem = {
  commit: string;
  shortCommit: string;
  authorName: string;
  authorEmail?: string;
  authoredAt: string;
  summary: string;
  confidence: ProvenanceConfidence;
  heuristic: boolean;
  detectionMethod: string;
};

type SpanCommitHistorySourceResult =
  | {
      status: "available";
      items: SpanCommitHistoryItem[];
      bounds: ProvenanceBounds;
    }
  | {
      status: "unavailable";
      code: string;
      message: string;
    };

type ContributorType = (typeof CONTRIBUTOR_TYPE_VALUES)[number];
type ContributorEvidenceKind = (typeof CONTRIBUTOR_EVIDENCE_KIND_VALUES)[number];

interface SpanContributor {
  label: string;
  type: ContributorType;
  confidence: ProvenanceConfidence;
  occurrences: number;
  evidenceKinds: ContributorEvidenceKind[];
  models: string[];
  sessions: string[];
  commits: string[];
}

interface SpanRange {
  startLine: number;
  endLine: number;
}

type LineageEntry = {
  kind: (typeof LINEAGE_ENTRY_KIND_VALUES)[number];
  id: string;
  timestamp: string;
  confidence: ProvenanceConfidence;
  heuristic: boolean;
  summary: string;
  detail?: string;
};

type SpanHistoryToolInput = {
  path: string;
  start_line: number;
  end_line: number;
  mode?: "local" | "remote" | "hybrid";
  limit?: number;
};

const SpanRangeSchema = z.object({
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const SpanCommitHistoryItemSchema = z.object({
  commit: z.string().min(1),
  shortCommit: z.string().min(1),
  authorName: z.string().min(1),
  authorEmail: z.string().min(1).optional(),
  authoredAt: z.string().min(1),
  summary: z.string().min(1),
  confidence: ProvenanceConfidenceSchema,
  heuristic: z.boolean(),
  detectionMethod: z.string().min(1),
});

const SpanCommitSourceSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    bounds: ProvenanceBoundsSchema,
    items: z.array(SpanCommitHistoryItemSchema),
  }),
  z.object({
    status: z.literal("unavailable"),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
]);

const SpanContributorSchema = z.object({
  label: z.string().min(1),
  type: z.enum(CONTRIBUTOR_TYPE_VALUES),
  confidence: ProvenanceConfidenceSchema,
  occurrences: z.number().int().positive(),
  evidenceKinds: z.array(z.enum(CONTRIBUTOR_EVIDENCE_KIND_VALUES)).min(1),
  models: z.array(z.string().min(1)),
  sessions: z.array(z.string().min(1)),
  commits: z.array(z.string().min(1)),
});

const SpanHistoryLineageEntrySchema = z.object({
  kind: z.enum(LINEAGE_ENTRY_KIND_VALUES),
  id: z.string().min(1),
  timestamp: z.string().min(1),
  confidence: ProvenanceConfidenceSchema,
  heuristic: z.boolean(),
  summary: z.string().min(1),
  detail: z.string().min(1).optional(),
});

export const ProvSpanHistoryDataSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  span: SpanRangeSchema,
  commits: SpanCommitSourceSchema,
  contributors: z.array(SpanContributorSchema),
  lineage: z.array(SpanHistoryLineageEntrySchema),
});

export const ProvSpanHistoryResultSchema = createProvenanceResultSchema(ProvSpanHistoryDataSchema);

export interface ProvSpanHistoryData {
  requestedPath: string;
  resolvedPath: string;
  span: SpanRange;
  commits: SpanCommitHistorySourceResult;
  contributors: SpanContributor[];
  lineage: LineageEntry[];
}
export type ProvSpanHistoryResult = ProvenanceResult<ProvSpanHistoryData>;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getHighestAmbiguity(warnings: readonly ProvenanceWarning[]): ProvenanceAmbiguity {
  let highest: ProvenanceAmbiguity = "none";

  for (const warning of warnings) {
    const ambiguity = warning.ambiguity ?? "low";
    if (AMBIGUITY_PRIORITY[ambiguity] > AMBIGUITY_PRIORITY[highest]) {
      highest = ambiguity;
    }
  }

  return highest;
}

function getHighestConfidence(
  left: ProvenanceConfidence,
  right: ProvenanceConfidence,
): ProvenanceConfidence {
  return CONFIDENCE_PRIORITY[left] >= CONFIDENCE_PRIORITY[right] ? left : right;
}

async function loadLocalSpanCommitHistory(options: {
  shell: CreateStateToolsOptions["shell"];
  path: string;
  startLine: number;
  endLine: number;
  limit: number | undefined;
}): Promise<SpanCommitHistorySourceResult> {
  const requestedLimit = options.limit;
  const limit = requestedLimit ?? DEFAULT_PROVENANCE_ITEM_LIMIT.defaultValue;
  const rangeSpec = `${options.startLine},${options.endLine}:${options.path}`;

  try {
    const raw = (
      await runProcessText({
        shell: options.shell,
        cmd: [
          "git",
          "log",
          "--no-patch",
          `--format=${GIT_RANGE_HISTORY_FORMAT}`,
          "-n",
          String(limit),
          "-L",
          rangeSpec,
        ],
        maxOutputBytes: RANGE_HISTORY_PARSE_MAX_OUTPUT_BYTES,
        trim: false,
      })
    ).trim();

    const parsedItems = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        const [commit, authorName, authorEmail, authoredAt, summary] = line.split("\u001f");
        if (!commit || !authorName || !authoredAt) {
          return [];
        }

        return [
          {
            commit,
            shortCommit: commit.slice(0, 12),
            authorName,
            authorEmail: authorEmail?.trim() ? authorEmail : undefined,
            authoredAt,
            summary: summary?.trim() || "(no summary)",
            confidence: "medium" as const,
            heuristic: false,
            detectionMethod: GIT_RANGE_HISTORY_METHOD,
          },
        ];
      });

    const bounded = applyBoundedLimit(parsedItems, requestedLimit, DEFAULT_PROVENANCE_ITEM_LIMIT);
    return {
      status: "available",
      items: bounded.items,
      bounds: bounded.bounds,
    };
  } catch (error) {
    return {
      status: "unavailable",
      code: "range_history_unavailable",
      message: `Git range history is unavailable for '${options.path}:${options.startLine}-${options.endLine}': ${toErrorMessage(error)}`,
    };
  }
}

function toCommitWarnings(commits: SpanCommitHistorySourceResult): ProvenanceWarning[] {
  if (commits.status === "unavailable") {
    return [
      {
        code: commits.code,
        message: commits.message,
        ambiguity: "low",
      },
    ];
  }

  if (commits.items.length === 0) {
    return [
      {
        code: "commit_history_empty",
        message: "No committed range history matched the requested path and line span.",
        ambiguity: "low",
      },
    ];
  }

  return [];
}

function createSpanHistoryWarnings(
  commits: SpanCommitHistorySourceResult,
): ProvenanceWarning[] {
  return [
    {
      code: "path_range_only_lineage",
      message:
        "Commit lineage is limited to the current path and requested line range; rename or refactor ancestry is not followed.",
      ambiguity: "low",
    },
    ...toCommitWarnings(commits),
  ];
}

function resolveSpanHistoryConfidence(data: {
  commits: ProvSpanHistoryData["commits"];
}): ProvenanceConfidence {
  if (data.commits.status === "available" && data.commits.items.length > 0) {
    return "medium";
  }

  return "low";
}

function createLineageEntries(data: {
  path: string;
  commits: ProvSpanHistoryData["commits"];
  limit: number | undefined;
}): {
  items: LineageEntry[];
  bounds: z.infer<typeof ProvenanceBoundsSchema>;
} {
  const commitEntries: LineageEntry[] =
    data.commits.status === "available"
      ? data.commits.items.map((item) => ({
          kind: "commit",
          id: item.commit,
          timestamp: item.authoredAt,
          confidence: item.confidence,
          heuristic: item.heuristic,
          summary: `${item.shortCommit} ${item.summary}`,
          detail: `${item.authorName} (${data.path})`,
        }))
      : [];

  const ranked = commitEntries.sort(
    (left, right) => parseTimestamp(right.timestamp) - parseTimestamp(left.timestamp),
  );

  return applyBoundedLimit(ranked, data.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
}

function buildContributorSummaries(data: {
  commits: ProvSpanHistoryData["commits"];
}): ProvSpanHistoryData["contributors"] {
  const contributors = new Map<
    string,
    {
      label: string;
      type: (typeof CONTRIBUTOR_TYPE_VALUES)[number];
      confidence: ProvenanceConfidence;
      occurrences: number;
      evidenceKinds: Set<(typeof CONTRIBUTOR_EVIDENCE_KIND_VALUES)[number]>;
      models: Set<string>;
      sessions: Set<string>;
      commits: Set<string>;
    }
  >();

  const upsert = (options: {
    key: string;
    label: string;
    type: (typeof CONTRIBUTOR_TYPE_VALUES)[number];
    confidence: ProvenanceConfidence;
    evidenceKind: (typeof CONTRIBUTOR_EVIDENCE_KIND_VALUES)[number];
    model?: string;
    session?: string;
    commit?: string;
  }) => {
    const current = contributors.get(options.key);
    if (current) {
      current.occurrences += 1;
      current.confidence = getHighestConfidence(current.confidence, options.confidence);
      current.evidenceKinds.add(options.evidenceKind);
      if (options.model) current.models.add(options.model);
      if (options.session) current.sessions.add(options.session);
      if (options.commit) current.commits.add(options.commit);
      return;
    }

    contributors.set(options.key, {
      label: options.label,
      type: options.type,
      confidence: options.confidence,
      occurrences: 1,
      evidenceKinds: new Set([options.evidenceKind]),
      models: new Set(options.model ? [options.model] : []),
      sessions: new Set(options.session ? [options.session] : []),
      commits: new Set(options.commit ? [options.commit] : []),
    });
  };

  if (data.commits.status === "available") {
    for (const item of data.commits.items) {
      const label = item.authorEmail ? `${item.authorName} <${item.authorEmail}>` : item.authorName;
      upsert({
        key: `git:${label}`,
        label,
        type: "human",
        confidence: item.confidence,
        evidenceKind: "git",
        commit: item.commit,
      });
    }
  }

  return [...contributors.values()]
    .map((contributor) => ({
      label: contributor.label,
      type: contributor.type,
      confidence: contributor.confidence,
      occurrences: contributor.occurrences,
      evidenceKinds: [...contributor.evidenceKinds].sort(),
      models: [...contributor.models].sort(),
      sessions: [...contributor.sessions].sort(),
      commits: [...contributor.commits].sort(),
    }))
    .sort((left, right) => {
      if (right.occurrences !== left.occurrences) {
        return right.occurrences - left.occurrences;
      }

      return left.label.localeCompare(right.label);
    });
}

function toCommitEvidenceSources(
  path: string,
  commits: ProvSpanHistoryData["commits"],
): ProvenanceEvidenceSource[] {
  if (commits.status !== "available") {
    return [];
  }

  return commits.items.map((item) => ({
    kind: "git",
    id: item.commit,
    ref: item.commit,
    path,
    label: item.shortCommit,
    detail: item.summary,
  }));
}

function createSpanHistorySummary(data: ProvSpanHistoryData): string {
  const commitSummary =
    data.commits.status === "available"
      ? `${data.commits.items.length} commit history item(s)`
      : "commit history unavailable";

  return `Span history for ${data.resolvedPath}:${data.span.startLine}-${data.span.endLine}: ${commitSummary}, ${data.contributors.length} contributor(s).`;
}

export interface ResolveLocalSpanLineageOptions {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  requestedPath: string;
  normalizedPath: string;
  startLine: number;
  endLine: number;
  limit: number | undefined;
}

export interface LocalSpanLineageResolution {
  data: ProvSpanHistoryData;
  warnings: ProvenanceWarning[];
  sources: ProvenanceEvidenceSource[];
  confidence: ProvenanceConfidence;
  ambiguity: ProvenanceAmbiguity;
  bounds: ProvenanceBounds;
  summary: string;
}

export async function resolveLocalSpanLineage(
  options: ResolveLocalSpanLineageOptions,
): Promise<LocalSpanLineageResolution> {
  const commitHistory = await loadLocalSpanCommitHistory({
    shell: options.shell,
    path: options.normalizedPath,
    startLine: options.startLine,
    endLine: options.endLine,
    limit: options.limit,
  });

  const dataWithoutLineage = {
    requestedPath: options.requestedPath.trim(),
    resolvedPath: options.normalizedPath,
    span: {
      startLine: options.startLine,
      endLine: options.endLine,
    },
    commits: commitHistory,
    contributors: [] as ProvSpanHistoryData["contributors"],
    lineage: [] as ProvSpanHistoryData["lineage"],
  } satisfies Omit<ProvSpanHistoryData, "contributors" | "lineage"> & {
    contributors: ProvSpanHistoryData["contributors"];
    lineage: ProvSpanHistoryData["lineage"];
  };

  const contributors = buildContributorSummaries({
    commits: dataWithoutLineage.commits,
  });
  const lineage = createLineageEntries({
    path: options.normalizedPath,
    commits: dataWithoutLineage.commits,
    limit: options.limit,
  });
  const data: ProvSpanHistoryData = {
    ...dataWithoutLineage,
    contributors,
    lineage: lineage.items,
  };
  const warnings = createSpanHistoryWarnings(commitHistory);

  return {
    data,
    warnings,
    sources: toCommitEvidenceSources(options.normalizedPath, data.commits),
    confidence: resolveSpanHistoryConfidence(data),
    ambiguity: getHighestAmbiguity(warnings),
    bounds: lineage.bounds,
    summary: createSpanHistorySummary(data),
  };
}

export function createLineageTools(
  options: CreateStateToolsOptions,
): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [GW_SPAN_HISTORY_TOOL]: createSpanHistoryTool(runtimeOptions),
  };
}

function createSpanHistoryTool(runtimeOptions: ReturnType<typeof normalizeCreateStateToolsOptions>): ToolDefinition {
	  return tool({
	    description:
	      "Return bounded span-level lineage from git range history for one file plus line range, with contributor summaries and confidence signals.",
    args: {
      path: provenancePathArg,
      start_line: provenanceStartLineArg,
      end_line: provenanceEndLineArg,
      mode: provenanceModeArg,
      limit: provenanceLimitArg,
    },
    execute: (input: SpanHistoryToolInput) => executeSpanHistoryTool(input, runtimeOptions),
  });
}

async function executeSpanHistoryTool(
  {
    path: requestedPath,
    start_line: startLine,
    end_line: endLine,
    mode,
    limit,
  }: SpanHistoryToolInput,
  runtimeOptions: ReturnType<typeof normalizeCreateStateToolsOptions>,
): Promise<string> {
  const resolvedMode = mode ?? "local";

  if (resolvedMode !== "local") {
    logger.warn("gw_span_history unsupported mode", {
      tool: GW_SPAN_HISTORY_TOOL,
      mode: resolvedMode,
    });
    return createUnsupportedModeFailure(GW_SPAN_HISTORY_TOOL, resolvedMode);
  }

  if (endLine < startLine) {
    return createInvalidSpanFailure(requestedPath, startLine, endLine);
  }

  let normalizedPath: string;
  try {
    normalizedPath = normalizeRequestedPath(requestedPath, runtimeOptions.rootDir);
  } catch (error) {
    return createPathNormalizationFailure(requestedPath, error);
  }

  logSpanHistoryStart({
    mode: resolvedMode,
    normalizedPath,
    startLine,
    endLine,
    limit,
  });

  try {
    const lineageResolution = await resolveLocalSpanLineage({
      shell: runtimeOptions.shell,
      rootDir: runtimeOptions.rootDir ?? process.cwd(),
      requestedPath,
      normalizedPath,
      startLine,
      endLine,
      limit,
    });
    return serializeSpanHistorySuccess({
      lineageResolution,
      normalizedPath,
      startLine,
      endLine,
    });
  } catch (error) {
    return createSpanHistoryUnavailableFailure({
      error,
      mode: resolvedMode,
      normalizedPath,
      startLine,
      endLine,
    });
  }
}

function createInvalidSpanFailure(
  requestedPath: string,
  startLine: number,
  endLine: number,
): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: GW_SPAN_HISTORY_TOOL,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Invalid span '${requestedPath}:${startLine}-${endLine}'.`,
      error: {
        code: "SPAN_RANGE_INVALID",
        message: "end_line must be greater than or equal to start_line.",
      },
    }),
    null,
    2,
  );
}

function createPathNormalizationFailure(requestedPath: string, error: unknown): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: GW_SPAN_HISTORY_TOOL,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Failed to normalize path '${requestedPath}'.`,
      error: {
        code: "SPAN_HISTORY_PATH_INVALID",
        message: toErrorMessage(error),
      },
    }),
    null,
    2,
  );
}

function logSpanHistoryStart(options: {
  mode: string;
  normalizedPath: string;
  startLine: number;
  endLine: number;
  limit: number | undefined;
}): void {
  logger.info("gw_span_history start", {
    tool: GW_SPAN_HISTORY_TOOL,
    mode: options.mode,
    path: options.normalizedPath,
    startLine: options.startLine,
    endLine: options.endLine,
    limit: options.limit,
  });
}

function serializeSpanHistorySuccess(options: {
  lineageResolution: LocalSpanLineageResolution;
  normalizedPath: string;
  startLine: number;
  endLine: number;
}): string {
  const { lineageResolution } = options;
  const response = createProvenanceSuccess({
    tool: GW_SPAN_HISTORY_TOOL,
    mode: "local",
    confidence: lineageResolution.confidence,
    ambiguity: lineageResolution.ambiguity,
    bounds: lineageResolution.bounds,
    summary: lineageResolution.summary,
    warnings: lineageResolution.warnings,
    sources: lineageResolution.sources,
    data: lineageResolution.data,
  });

  logger.info("gw_span_history end", {
    tool: GW_SPAN_HISTORY_TOOL,
    confidence: response.meta.confidence,
    ambiguity: response.meta.ambiguity,
    path: options.normalizedPath,
    startLine: options.startLine,
	    endLine: options.endLine,
	    commitStatus: lineageResolution.data.commits.status,
    contributors: lineageResolution.data.contributors.length,
    lineage: lineageResolution.data.lineage.length,
  });

  return JSON.stringify(response, null, 2);
}

function createSpanHistoryUnavailableFailure(options: {
  error: unknown;
  mode: string;
  normalizedPath: string;
  startLine: number;
  endLine: number;
}): string {
  const errorMessage = toErrorMessage(options.error);
  logger.error("gw_span_history failed", {
    tool: GW_SPAN_HISTORY_TOOL,
    mode: options.mode,
    path: options.normalizedPath,
    startLine: options.startLine,
    endLine: options.endLine,
    error: errorMessage,
  });

  return JSON.stringify(
    createProvenanceFailure({
      tool: GW_SPAN_HISTORY_TOOL,
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Failed to resolve span history for '${options.normalizedPath}:${options.startLine}-${options.endLine}'.`,
      error: {
        code: "SPAN_HISTORY_UNAVAILABLE",
        message: errorMessage,
      },
    }),
    null,
    2,
  );
}
