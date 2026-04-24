import path from "node:path";
import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { z } from "zod";
import { attachProcessRunner } from "../../../../shared/effect-runtime.ts";
import {
  createBoundedNumberArg,
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  provenanceBaseArg,
  provenanceModeArg,
  provenancePathArg,
  resolveBoundedNumber,
} from "../args.ts";
import {
  createProvenanceFailure,
  createProvenanceResultSchema,
  createProvenanceSuccess,
  ProvenanceAmbiguitySchema,
  ProvenanceConfidenceSchema,
  type ProvenanceEvidenceSource,
  type ProvenanceWarning,
} from "../contracts.ts";
import { logger } from "../utils/logger.ts";
import {
  LOCAL_BASE_DETECTION_KIND_VALUES,
  LOCAL_FILE_COMPARISON_STATUS_VALUES,
  LOCAL_REPO_AMBIGUITY_CODE_VALUES,
  LOCAL_REPO_FILE_STATUS_VALUES,
  resolveLocalFileState,
  resolveLocalRepoState,
  type LocalFileState,
  type LocalRepoState,
  type Shell,
} from "./local-state.ts";

export * from "./local-state.ts";

const PROV_REPO_STATE_TOOL = "prov_repo_state" as const;
const PROV_FILE_STATE_TOOL = "prov_file_state" as const;

const repoStateLimitArg = createBoundedNumberArg({
  ...DEFAULT_PROVENANCE_ITEM_LIMIT,
  description: "Max files to include in each staged, unstaged, and untracked summary",
});

const LocalRepoFileStatusSchema = z.object({
  status: z.enum(LOCAL_REPO_FILE_STATUS_VALUES),
  path: z.string().min(1),
  newPath: z.string().min(1).optional(),
});

const LocalRepoAmbiguityIssueSchema = z.object({
  code: z.enum(LOCAL_REPO_AMBIGUITY_CODE_VALUES),
  level: ProvenanceAmbiguitySchema,
  message: z.string().min(1),
});

const RepoBranchSummarySchema = z.object({
  name: z.string().nullable(),
  ref: z.string().nullable(),
  detached: z.boolean(),
  upstream: z.string().nullable(),
  hasMatchingRemoteBranch: z.boolean(),
  isLocalOnly: z.boolean(),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

const RepoBaseSummarySchema = z.object({
  ref: z.string().nullable(),
  branchName: z.string().nullable(),
  detectionKind: z.enum(LOCAL_BASE_DETECTION_KIND_VALUES),
  explicit: z.boolean(),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

const RepoHeadSummarySchema = z.object({
  ref: z.literal("HEAD"),
  commit: z.string().nullable(),
  shortCommit: z.string().nullable(),
  detached: z.boolean(),
  branchName: z.string().nullable(),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

const RepoTrackedChangeSummarySchema = z.object({
  ref: z.enum(["index", "worktree"]),
  dirty: z.boolean(),
  count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  files: z.array(LocalRepoFileStatusSchema),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

const RepoUntrackedSummarySchema = z.object({
  ref: z.literal("worktree"),
  count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  files: z.array(z.string().min(1)),
  confidence: ProvenanceConfidenceSchema,
  detectionMethod: z.string().min(1),
});

export const ProvRepoStateDataSchema = z.object({
  branch: RepoBranchSummarySchema,
  base: RepoBaseSummarySchema,
  head: RepoHeadSummarySchema,
  staged: RepoTrackedChangeSummarySchema.extend({ ref: z.literal("index") }),
  unstaged: RepoTrackedChangeSummarySchema.extend({ ref: z.literal("worktree") }),
  untracked: RepoUntrackedSummarySchema,
  ambiguity: z.object({
    level: ProvenanceAmbiguitySchema,
    issues: z.array(LocalRepoAmbiguityIssueSchema),
  }),
});

export const ProvRepoStateResultSchema = createProvenanceResultSchema(ProvRepoStateDataSchema);

export type ProvRepoStateData = z.infer<typeof ProvRepoStateDataSchema>;
export type ProvRepoStateResult = z.infer<typeof ProvRepoStateResultSchema>;

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

export type ProvFileStateData = z.infer<typeof ProvFileStateDataSchema>;
export type ProvFileStateResult = z.infer<typeof ProvFileStateResultSchema>;

export interface CreateStateToolsOptions {
  shell: Shell;
  rootDir?: string;
}

export function normalizeCreateStateToolsOptions(
  options: CreateStateToolsOptions,
): CreateStateToolsOptions {
  const rootDir = options.rootDir ? path.resolve(options.rootDir) : undefined;

  return {
    rootDir,
    shell: attachProcessRunner(options.shell, { cwd: rootDir }),
  };
}

function getBoundedItems<T>(
  items: readonly T[],
  requestedLimit: number | undefined,
): {
  items: T[];
  truncated: boolean;
} {
  const limit = resolveBoundedNumber(requestedLimit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const boundedItems = items.slice(0, limit);

  return {
    items: [...boundedItems],
    truncated: items.length > limit,
  };
}

export function toProvRepoStateData(
  state: LocalRepoState,
  requestedLimit: number | undefined,
): ProvRepoStateData {
  const staged = getBoundedItems(state.index.files, requestedLimit);
  const unstaged = getBoundedItems(state.worktree.files, requestedLimit);
  const untracked = getBoundedItems(state.untracked.files, requestedLimit);

  return {
    branch: {
      name: state.currentBranch.name,
      ref: state.currentBranch.ref,
      detached: state.currentBranch.detached,
      upstream: state.currentBranch.upstream,
      hasMatchingRemoteBranch: state.currentBranch.hasMatchingRemoteBranch,
      isLocalOnly: state.currentBranch.isLocalOnly,
      confidence: state.currentBranch.confidence,
      detectionMethod: state.currentBranch.detectionMethod,
    },
    base: {
      ref: state.base.ref,
      branchName: state.base.branchName,
      detectionKind: state.base.detection.kind,
      explicit: state.base.detection.explicit,
      confidence: state.base.confidence,
      detectionMethod: state.base.detectionMethod,
    },
    head: {
      ref: state.head.ref,
      commit: state.head.commit,
      shortCommit: state.head.shortCommit,
      detached: state.head.detached,
      branchName: state.head.branchName,
      confidence: state.head.confidence,
      detectionMethod: state.head.detectionMethod,
    },
    staged: {
      ref: state.index.ref,
      dirty: state.index.dirty,
      count: state.index.count,
      truncated: staged.truncated,
      files: staged.items,
      confidence: state.index.confidence,
      detectionMethod: state.index.detectionMethod,
    },
    unstaged: {
      ref: state.worktree.ref,
      dirty: state.worktree.dirty,
      count: state.worktree.count,
      truncated: unstaged.truncated,
      files: unstaged.items,
      confidence: state.worktree.confidence,
      detectionMethod: state.worktree.detectionMethod,
    },
    untracked: {
      ref: state.untracked.ref,
      count: state.untracked.count,
      truncated: untracked.truncated,
      files: untracked.items,
      confidence: state.untracked.confidence,
      detectionMethod: state.untracked.detectionMethod,
    },
    ambiguity: state.ambiguity,
  };
}

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

function toAmbiguityWarnings(state: {
  ambiguity: LocalRepoState["ambiguity"];
}): ProvenanceWarning[] {
  return state.ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
}

function toRepoStateWarnings(state: LocalRepoState): ProvenanceWarning[] {
  return toAmbiguityWarnings(state);
}

function toFileStateWarnings(state: LocalFileState): ProvenanceWarning[] {
  return toAmbiguityWarnings(state);
}

function toRepoStateSources(state: LocalRepoState): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: "HEAD",
      ref: state.head.ref,
      label: state.head.branchName ?? "detached HEAD",
      detail: state.head.shortCommit ?? "HEAD unavailable",
    },
    {
      kind: "git",
      id: "base",
      ref: state.base.ref ?? state.base.detection.kind,
      label: "base",
      detail: state.base.detectionMethod,
    },
    {
      kind: "git",
      id: "index",
      ref: state.index.ref,
      label: "staged",
      detail: `${state.index.count} file(s)`,
    },
    {
      kind: "git",
      id: "worktree",
      ref: state.worktree.ref,
      label: "unstaged",
      detail: `${state.worktree.count} file(s)`,
    },
    {
      kind: "git",
      id: "untracked",
      ref: state.untracked.ref,
      label: "untracked",
      detail: `${state.untracked.count} file(s)`,
    },
  ];

  if (state.currentBranch.ref || state.currentBranch.name) {
    sources.unshift({
      kind: "git",
      id: "branch",
      ref: state.currentBranch.ref ?? "HEAD",
      label: state.currentBranch.name ?? "detached HEAD",
      detail: state.currentBranch.detectionMethod,
    });
  }

  return sources;
}

function createRepoStateSummary(data: ProvRepoStateData): string {
  const branchLabel = data.branch.name ?? "detached HEAD";
  const baseLabel = data.base.ref ?? "base unresolved";

  return `Local repo state for ${branchLabel} against ${baseLabel}: ${data.staged.count} staged, ${data.unstaged.count} unstaged, ${data.untracked.count} untracked.`;
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

function createUnsupportedModeFailure(
  toolName: typeof PROV_REPO_STATE_TOOL | typeof PROV_FILE_STATE_TOOL,
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

export function createStateTools(options: CreateStateToolsOptions): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [PROV_REPO_STATE_TOOL]: tool({
      description:
        "Report local repository branch, base, HEAD, staged, unstaged, and untracked summaries with confidence and detection methods.",
      args: {
        base: provenanceBaseArg,
        mode: provenanceModeArg,
        limit: repoStateLimitArg,
      },
      async execute({ base, mode, limit }) {
        const resolvedMode = mode ?? "local";

        if (resolvedMode !== "local") {
          logger.warn("prov_repo_state unsupported mode", {
            tool: PROV_REPO_STATE_TOOL,
            mode: resolvedMode,
          });
          return createUnsupportedModeFailure(PROV_REPO_STATE_TOOL, resolvedMode);
        }

        logger.info("prov_repo_state start", {
          tool: PROV_REPO_STATE_TOOL,
          mode: resolvedMode,
          base,
          limit,
        });

        try {
          const state = await resolveLocalRepoState({
            shell: runtimeOptions.shell,
            explicitBase: base,
          });
          const data = toProvRepoStateData(state, limit);
          const response = createProvenanceSuccess({
            tool: PROV_REPO_STATE_TOOL,
            mode: "local",
            confidence: state.confidence,
            ambiguity: state.ambiguity.level,
            summary: createRepoStateSummary(data),
            warnings: toRepoStateWarnings(state),
            sources: toRepoStateSources(state),
            data,
          });

          logger.info("prov_repo_state end", {
            tool: PROV_REPO_STATE_TOOL,
            confidence: response.meta.confidence,
            ambiguity: response.meta.ambiguity,
            branch: data.branch.name,
            base: data.base.ref,
            staged: data.staged.count,
            unstaged: data.unstaged.count,
            untracked: data.untracked.count,
          });

          return JSON.stringify(response, null, 2);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("prov_repo_state failed", {
            tool: PROV_REPO_STATE_TOOL,
            mode: resolvedMode,
            base,
            error: errorMessage,
          });

          return JSON.stringify(
            createProvenanceFailure({
              tool: PROV_REPO_STATE_TOOL,
              mode: "local",
              confidence: "unknown",
              ambiguity: "high",
              summary: "Failed to resolve local repo state.",
              error: {
                code: "REPO_STATE_UNAVAILABLE",
                message: errorMessage,
              },
            }),
            null,
            2,
          );
        }
      },
    }),
    [PROV_FILE_STATE_TOOL]: tool({
      description:
        "Report one path's existence and change status across base, HEAD, index, and worktree, including rename metadata when detectable.",
      args: {
        path: provenancePathArg,
        base: provenanceBaseArg,
        mode: provenanceModeArg,
      },
      async execute({ path: requestedPath, base, mode }) {
        const resolvedMode = mode ?? "local";

        if (resolvedMode !== "local") {
          logger.warn("prov_file_state unsupported mode", {
            tool: PROV_FILE_STATE_TOOL,
            mode: resolvedMode,
          });
          return createUnsupportedModeFailure(PROV_FILE_STATE_TOOL, resolvedMode);
        }

        let normalizedPath: string;
        try {
          normalizedPath = normalizeRequestedPath(requestedPath, runtimeOptions.rootDir);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("prov_file_state invalid path", {
            tool: PROV_FILE_STATE_TOOL,
            path: requestedPath,
            error: errorMessage,
          });

          return JSON.stringify(
            createProvenanceFailure({
              tool: PROV_FILE_STATE_TOOL,
              mode: "local",
              confidence: "unknown",
              ambiguity: "high",
              summary: `Failed to normalize path '${requestedPath}'.`,
              error: {
                code: "FILE_STATE_PATH_INVALID",
                message: errorMessage,
              },
            }),
            null,
            2,
          );
        }

        logger.info("prov_file_state start", {
          tool: PROV_FILE_STATE_TOOL,
          mode: resolvedMode,
          base,
          path: normalizedPath,
        });

        try {
          const state = await resolveLocalFileState({
            shell: runtimeOptions.shell,
            requestedPath: normalizedPath,
            explicitBase: base,
          });
          const data = toProvFileStateData(state);
          const response = createProvenanceSuccess({
            tool: PROV_FILE_STATE_TOOL,
            mode: "local",
            confidence: state.confidence,
            ambiguity: state.ambiguity.level,
            summary: createFileStateSummary(data),
            warnings: toFileStateWarnings(state),
            sources: toFileStateSources(data),
            data,
          });

          logger.info("prov_file_state end", {
            tool: PROV_FILE_STATE_TOOL,
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
          logger.error("prov_file_state failed", {
            tool: PROV_FILE_STATE_TOOL,
            mode: resolvedMode,
            base,
            path: normalizedPath,
            error: errorMessage,
          });

          return JSON.stringify(
            createProvenanceFailure({
              tool: PROV_FILE_STATE_TOOL,
              mode: "local",
              confidence: "unknown",
              ambiguity: "high",
              summary: `Failed to resolve file state for '${normalizedPath}'.`,
              error: {
                code: "FILE_STATE_UNAVAILABLE",
                message: errorMessage,
              },
            }),
            null,
            2,
          );
        }
      },
    }),
  };
}
