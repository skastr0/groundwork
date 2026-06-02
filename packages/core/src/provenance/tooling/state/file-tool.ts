import path from "node:path";
import { tool, type ToolDefinition } from "../tool.ts";
import { z } from "zod";
import { provenanceBaseArg, provenanceModeArg, provenancePathArg } from "../args.ts";
import {
  createProvenanceFailure,
  createProvenanceResultSchema,
  createProvenanceSuccess,
  ProvenanceAmbiguitySchema,
  ProvenanceConfidenceSchema,
  type ProvenanceAmbiguity,
  type ProvenanceEvidenceSource,
  type ProvenanceResult,
  type ProvenanceWarning,
} from "../contracts.ts";
import { createUnsupportedModeFailure } from "../shared.ts";
import { logger } from "../utils/logger.ts";
import {
  LOCAL_FILE_COMPARISON_STATUS_VALUES,
  LOCAL_REPO_AMBIGUITY_CODE_VALUES,
  resolveLocalFileState,
  type LocalFileComparison,
  type LocalFileLayerState,
  type LocalRepoAmbiguityIssue,
  type LocalFileState,
} from "./local-state.ts";
import type { CreateStateToolsOptions } from "./tool-options.ts";

export const GW_FILE_STATE_TOOL = "gw_file_state" as const;

const LocalRepoAmbiguityIssueSchema = z.object({
  code: z.enum(LOCAL_REPO_AMBIGUITY_CODE_VALUES),
  level: ProvenanceAmbiguitySchema,
  message: z.string().min(1),
});

const FileLayerSummarySchema = z.object({
  ref: z.string().nullable(),
  path: z.string().min(1),
  exists: z.boolean(),
  mode: z.string().min(1).nullable(),
  objectId: z.string().min(1).nullable(),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

const FileComparisonSchema = z.object({
  fromRef: z.string().min(1),
  toRef: z.string().min(1),
  fromPath: z.string().min(1),
  toPath: z.string().min(1),
  status: z.enum(LOCAL_FILE_COMPARISON_STATUS_VALUES),
  detected: z.boolean(),
  detectionMethod: z.string().min(1),
});

export const ProvFileStateDataSchema = z.object({
  requestedPath: z.string().min(1),
  resolvedPath: z.string().min(1),
  base: FileLayerSummarySchema,
  head: FileLayerSummarySchema.extend({ ref: z.literal("HEAD") }),
  index: FileLayerSummarySchema.extend({ ref: z.literal("index") }),
  worktree: FileLayerSummarySchema.extend({ ref: z.literal("worktree") }),
  comparisons: z.object({
    baseToHead: FileComparisonSchema.extend({ toRef: z.literal("HEAD") }),
    headToIndex: FileComparisonSchema.extend({
      fromRef: z.literal("HEAD"),
      toRef: z.literal("index"),
    }),
    indexToWorktree: FileComparisonSchema.extend({
      fromRef: z.literal("index"),
      toRef: z.literal("worktree"),
    }),
  }),
  ambiguity: z.object({
    level: ProvenanceAmbiguitySchema,
    issues: z.array(LocalRepoAmbiguityIssueSchema),
  }),
});

export const ProvFileStateResultSchema = createProvenanceResultSchema(ProvFileStateDataSchema);

type FileLayerSummary = LocalFileLayerState;

type HeadFileLayerSummary = FileLayerSummary & { ref: "HEAD" };
type IndexFileLayerSummary = FileLayerSummary & { ref: "index" };
type WorktreeFileLayerSummary = FileLayerSummary & { ref: "worktree" };

type BaseToHeadComparison = LocalFileComparison & { toRef: "HEAD" };
type HeadToIndexComparison = LocalFileComparison & {
  fromRef: "HEAD";
  toRef: "index";
};
type IndexToWorktreeComparison = LocalFileComparison & {
  fromRef: "index";
  toRef: "worktree";
};

export interface ProvFileStateData {
  requestedPath: string;
  resolvedPath: string;
  base: FileLayerSummary;
  head: HeadFileLayerSummary;
  index: IndexFileLayerSummary;
  worktree: WorktreeFileLayerSummary;
  comparisons: {
    baseToHead: BaseToHeadComparison;
    headToIndex: HeadToIndexComparison;
    indexToWorktree: IndexToWorktreeComparison;
  };
  ambiguity: {
    level: ProvenanceAmbiguity;
    issues: LocalRepoAmbiguityIssue[];
  };
}
export type ProvFileStateResult = ProvenanceResult<ProvFileStateData>;

type FileStateToolArgs = {
  path: string;
  base?: string;
  mode?: string;
};

type NormalizedFileStatePathResult =
  | {
      ok: true;
      path: string;
    }
  | {
      ok: false;
      response: string;
    };

export function toProvFileStateData(state: LocalFileState): ProvFileStateData {
  return {
    requestedPath: state.requestedPath,
    resolvedPath: state.resolvedPath,
    base: state.base,
    head: {
      ...state.head,
      ref: "HEAD",
    },
    index: {
      ...state.index,
      ref: "index",
    },
    worktree: {
      ...state.worktree,
      ref: "worktree",
    },
    comparisons: {
      baseToHead: {
        ...state.comparisons.baseToHead,
        toRef: "HEAD",
      },
      headToIndex: {
        ...state.comparisons.headToIndex,
        fromRef: "HEAD",
        toRef: "index",
      },
      indexToWorktree: {
        ...state.comparisons.indexToWorktree,
        fromRef: "index",
        toRef: "worktree",
      },
    },
    ambiguity: state.ambiguity,
  };
}

export function normalizeRequestedPath(requestedPath: string, rootDir?: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    return trimmed;
  }

  if (!path.isAbsolute(trimmed)) {
    return trimmed.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  if (!rootDir) {
    return trimmed.replace(/\\/g, "/");
  }

  const relative = path.relative(rootDir, trimmed);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path '${trimmed}' is outside worktree '${rootDir}'.`);
  }

  return relative.replace(/\\/g, "/");
}

export function createFileStateTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
  return tool({
    description:
      "Report one path's existence and change status across base, HEAD, index, and worktree, including rename metadata when detectable.",
    args: {
      path: provenancePathArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
    },
    execute: (args) => executeFileStateTool(runtimeOptions, args),
  });
}

function toFileStateWarnings(state: LocalFileState): ProvenanceWarning[] {
  return state.ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
}

function formatLayerPresence(label: string, exists: boolean): string {
  return `${label} ${exists ? "present" : "absent"}`;
}

function formatComparison(
  label: string,
  comparison: ProvFileStateData["comparisons"][keyof ProvFileStateData["comparisons"]],
): string {
  const pathLabel =
    comparison.fromPath === comparison.toPath
      ? comparison.toPath
      : `${comparison.fromPath} -> ${comparison.toPath}`;

  return `${label} ${comparison.status} (${pathLabel})`;
}

function createFileStateSummary(data: ProvFileStateData): string {
  return [
    `File state for ${data.requestedPath}:`,
    [
      formatLayerPresence("base", data.base.exists),
      formatLayerPresence("HEAD", data.head.exists),
      formatLayerPresence("index", data.index.exists),
      formatLayerPresence("worktree", data.worktree.exists),
    ].join(", "),
    [
      formatComparison("base->HEAD", data.comparisons.baseToHead),
      formatComparison("HEAD->index", data.comparisons.headToIndex),
      formatComparison("index->worktree", data.comparisons.indexToWorktree),
    ].join(", "),
  ].join(" ");
}

function toFileStateSources(state: ProvFileStateData): ProvenanceEvidenceSource[] {
  return [
    {
      kind: "git",
      id: "base-file",
      ref: state.base.ref ?? "base",
      label: "base",
      path: state.base.path,
      detail: state.base.exists ? "present" : "absent",
    },
    {
      kind: "git",
      id: "head-file",
      ref: state.head.ref,
      label: "HEAD",
      path: state.head.path,
      detail: state.head.exists ? "present" : "absent",
    },
    {
      kind: "git",
      id: "index-file",
      ref: state.index.ref,
      label: "index",
      path: state.index.path,
      detail: state.index.exists ? "present" : "absent",
    },
    {
      kind: "git",
      id: "worktree-file",
      ref: state.worktree.ref,
      label: "worktree",
      path: state.worktree.path,
      detail: state.worktree.exists ? "present" : "absent",
    },
  ];
}

function createFileStateFailure({
  summary,
  code,
  message,
}: {
  summary: string;
  code: string;
  message: string;
}): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: GW_FILE_STATE_TOOL,
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

function resolveFileStatePath(
  args: FileStateToolArgs,
  rootDir?: string,
): NormalizedFileStatePathResult {
  try {
    return {
      ok: true,
      path: normalizeRequestedPath(args.path, rootDir),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("gw_file_state invalid path", {
      tool: GW_FILE_STATE_TOOL,
      path: args.path,
      error: errorMessage,
    });

    return {
      ok: false,
      response: createFileStateFailure({
        summary: `Failed to normalize path '${args.path}'.`,
        code: "FILE_STATE_PATH_INVALID",
        message: errorMessage,
      }),
    };
  }
}

async function resolveFileState(
  runtimeOptions: CreateStateToolsOptions,
  args: FileStateToolArgs,
  normalizedPath: string,
): Promise<LocalFileState> {
  return resolveLocalFileState({
    shell: runtimeOptions.shell,
    requestedPath: normalizedPath,
    explicitBase: args.base,
  });
}

function createFileStateResponse(state: LocalFileState): {
  data: ProvFileStateData;
  response: ReturnType<typeof createProvenanceSuccess<ProvFileStateData>>;
} {
  const data = toProvFileStateData(state);
  const response = createProvenanceSuccess({
    tool: GW_FILE_STATE_TOOL,
    mode: "local",
    confidence: state.confidence,
    ambiguity: state.ambiguity.level,
    summary: createFileStateSummary(data),
    warnings: toFileStateWarnings(state),
    sources: toFileStateSources(data),
    data,
  });

  return { data, response };
}

function createFileStateUnavailableFailure(normalizedPath: string, error: unknown): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  return createFileStateFailure({
    summary: `Failed to resolve file state for '${normalizedPath}'.`,
    code: "FILE_STATE_UNAVAILABLE",
    message: errorMessage,
  });
}

async function executeFileStateTool(
  runtimeOptions: CreateStateToolsOptions,
  args: FileStateToolArgs,
): Promise<string> {
  const resolvedMode = args.mode ?? "local";

  if (resolvedMode !== "local") {
    logger.warn("gw_file_state unsupported mode", {
      tool: GW_FILE_STATE_TOOL,
      mode: resolvedMode,
    });
    return createUnsupportedModeFailure(GW_FILE_STATE_TOOL, resolvedMode);
  }

  const normalizedPath = resolveFileStatePath(args, runtimeOptions.rootDir);
  if (!normalizedPath.ok) {
    return normalizedPath.response;
  }

  logger.info("gw_file_state start", {
    tool: GW_FILE_STATE_TOOL,
    mode: resolvedMode,
    base: args.base,
    path: normalizedPath.path,
  });

  try {
    const state = await resolveFileState(runtimeOptions, args, normalizedPath.path);
    const { data, response } = createFileStateResponse(state);

    logger.info("gw_file_state end", {
      tool: GW_FILE_STATE_TOOL,
      confidence: response.meta.confidence,
      ambiguity: response.meta.ambiguity,
      path: data.requestedPath,
      resolvedPath: data.resolvedPath,
      baseExists: data.base.exists,
      headExists: data.head.exists,
      indexExists: data.index.exists,
      worktreeExists: data.worktree.exists,
    });

    return JSON.stringify(response, null, 2);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("gw_file_state failed", {
      tool: GW_FILE_STATE_TOOL,
      mode: resolvedMode,
      base: args.base,
      path: normalizedPath.path,
      error: errorMessage,
    });

    return createFileStateUnavailableFailure(normalizedPath.path, error);
  }
}
