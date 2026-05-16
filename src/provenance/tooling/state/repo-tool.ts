import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { z } from "zod";
import {
  createBoundedNumberArg,
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  provenanceBaseArg,
  provenanceModeArg,
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
import { createUnsupportedModeFailure } from "../shared.ts";
import { logger } from "../utils/logger.ts";
import {
  LOCAL_BASE_DETECTION_KIND_VALUES,
  LOCAL_REPO_AMBIGUITY_CODE_VALUES,
  LOCAL_REPO_FILE_STATUS_VALUES,
  resolveLocalRepoState,
  type LocalRepoState,
} from "./local-state.ts";
import type { CreateStateToolsOptions } from "./tool-options.ts";

export const GW_REPO_STATE_TOOL = "gw_repo_state" as const;

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

function toRepoStateWarnings(state: LocalRepoState): ProvenanceWarning[] {
  return state.ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
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

export function createRepoStateTool(runtimeOptions: CreateStateToolsOptions): ToolDefinition {
  return tool({
    description:
      "Report local repository branch, base, HEAD, staged, unstaged, and untracked summaries with confidence and detection methods.",
    args: {
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: repoStateLimitArg,
    },
    execute: (args) => executeRepoStateTool(runtimeOptions, args),
  });
}

async function executeRepoStateTool(
  runtimeOptions: CreateStateToolsOptions,
  args: {
    base?: string;
    mode?: string;
    limit?: number;
  },
): Promise<string> {
  const resolvedMode = args.mode ?? "local";

  if (resolvedMode !== "local") {
    logger.warn("gw_repo_state unsupported mode", {
      tool: GW_REPO_STATE_TOOL,
      mode: resolvedMode,
    });
    return createUnsupportedModeFailure(GW_REPO_STATE_TOOL, resolvedMode);
  }

  logger.info("gw_repo_state start", {
    tool: GW_REPO_STATE_TOOL,
    mode: resolvedMode,
    base: args.base,
    limit: args.limit,
  });

  try {
    return await executeLocalRepoState(runtimeOptions, args);
  } catch (error) {
    return createRepoStateUnavailableFailure(args, resolvedMode, error);
  }
}

async function executeLocalRepoState(
  runtimeOptions: CreateStateToolsOptions,
  args: {
    base?: string;
    limit?: number;
  },
): Promise<string> {
  const state = await resolveLocalRepoState({
    shell: runtimeOptions.shell,
    explicitBase: args.base,
  });
  const data = toProvRepoStateData(state, args.limit);
  const response = createProvenanceSuccess({
    tool: GW_REPO_STATE_TOOL,
    mode: "local",
    confidence: state.confidence,
    ambiguity: state.ambiguity.level,
    summary: createRepoStateSummary(data),
    warnings: toRepoStateWarnings(state),
    sources: toRepoStateSources(state),
    data,
  });

  logger.info("gw_repo_state end", {
    tool: GW_REPO_STATE_TOOL,
    confidence: response.meta.confidence,
    ambiguity: response.meta.ambiguity,
    branch: data.branch.name,
    base: data.base.ref,
    staged: data.staged.count,
    unstaged: data.unstaged.count,
    untracked: data.untracked.count,
  });

  return JSON.stringify(response, null, 2);
}

function createRepoStateUnavailableFailure(
  args: {
    base?: string;
  },
  resolvedMode: string,
  error: unknown,
): string {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error("gw_repo_state failed", {
    tool: GW_REPO_STATE_TOOL,
    mode: resolvedMode,
    base: args.base,
    error: errorMessage,
  });

  return JSON.stringify(
    createProvenanceFailure({
      tool: GW_REPO_STATE_TOOL,
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
