import {
  createProvenanceSuccess,
  type ProvenanceMode,
} from "../contracts.ts";
import type { CreateStateToolsOptions } from "../state/index.ts";
import { logger } from "../utils/logger.ts";
import { resolveTreeExpandCore } from "./tree-context.ts";
import {
  GW_TREE_EXPAND_TOOL,
  GW_WORKTREE_OVERVIEW_TOOL,
} from "./schemas.ts";
import {
  getHighestAmbiguity,
  getLowestConfidence,
  toErrorMessage,
} from "./shared.ts";
import { createToolFailure, resolveLocalMode } from "./tool-support.ts";
import {
  buildTreeExpandSummary,
  buildTreeSources,
  buildWorktreeOverviewSources,
  buildWorktreeOverviewSummary,
  collectTreeExpandWarnings,
  toWorktreeOverviewData,
} from "./tree-response.ts";
import type { TreeExpandCoreArgs } from "./tree-types.ts";

type TreeToolArgs = TreeExpandCoreArgs & {
  mode?: ProvenanceMode;
};

type WorktreeOverviewArgs = Omit<TreeExpandCoreArgs, "path"> & {
  mode?: ProvenanceMode;
};

type TreeExpandCoreResult = Awaited<ReturnType<typeof resolveTreeExpandCore>>;
type TreeExpandData = TreeExpandCoreResult["data"];
type WorktreeOverviewData = ReturnType<typeof toWorktreeOverviewData>;
type TreeExpandWarnings = ReturnType<typeof collectTreeExpandWarnings>;

function toResponseJson(response: unknown): string {
  return JSON.stringify(response, null, 2);
}

export async function executeTreeExpandTool(
  runtimeOptions: CreateStateToolsOptions,
  args: TreeToolArgs,
): Promise<string> {
  const unsupported = resolveLocalMode(GW_TREE_EXPAND_TOOL, args.mode);
  if (unsupported) {
    return unsupported;
  }

  logTreeExpandStart(args);

  try {
    const resolved = await resolveTreeExpandCore(runtimeOptions, args);
    const response = createTreeExpandSuccess(resolved);
    logTreeExpandEnd(resolved.data);
    return toResponseJson(response);
  } catch (error) {
    return createTreeExpandFailure(args, error);
  }
}

function logTreeExpandStart(args: TreeToolArgs): void {
  logger.info("gw_tree_expand start", {
    tool: GW_TREE_EXPAND_TOOL,
    path: args.path,
    base: args.base,
    scope: args.scope ?? "branch",
    limit: args.limit,
    maxBytes: args.max_bytes,
    maxDepth: args.max_depth,
  });
}

function createTreeExpandSuccess(resolved: TreeExpandCoreResult) {
  const warnings = collectTreeExpandWarnings(resolved.warnings, resolved.data);

  return createProvenanceSuccess({
    tool: GW_TREE_EXPAND_TOOL,
    mode: "local",
    confidence: getLowestConfidence([
      resolved.data.repo.branch.confidence,
      resolved.data.summary.changedFiles > 0 ? "high" : "medium",
    ]),
    ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
    bounds: resolved.data.bounds.areas,
    summary: buildTreeExpandSummary(resolved.data),
    warnings,
    sources: buildTreeSources(resolved.data),
    data: resolved.data,
  });
}

function logTreeExpandEnd(data: TreeExpandData): void {
  logger.info("gw_tree_expand end", {
    tool: GW_TREE_EXPAND_TOOL,
    anchor: data.anchor.resolvedPath,
    scope: data.scope.type,
    changedFiles: data.summary.changedFiles,
    areas: data.summary.areas,
    commits: data.summary.commits,
  });
}

function createTreeExpandFailure(args: TreeToolArgs, error: unknown): string {
  const message = toErrorMessage(error);
  logger.error("gw_tree_expand failed", {
    tool: GW_TREE_EXPAND_TOOL,
    path: args.path,
    error: message,
  });
  return createToolFailure({
    tool: GW_TREE_EXPAND_TOOL,
    summary: `Failed to expand tree anchor '${args.path}'.`,
    code: "TREE_EXPAND_FAILED",
    message,
  });
}

export async function executeWorktreeOverviewTool(
  runtimeOptions: CreateStateToolsOptions,
  args: WorktreeOverviewArgs,
): Promise<string> {
  const unsupported = resolveLocalMode(GW_WORKTREE_OVERVIEW_TOOL, args.mode);
  if (unsupported) {
    return unsupported;
  }

  logger.info("gw_worktree_overview start", {
    tool: GW_WORKTREE_OVERVIEW_TOOL,
    base: args.base,
    scope: args.scope ?? "working_tree",
    limit: args.limit,
    maxBytes: args.max_bytes,
    maxDepth: args.max_depth,
  });

  try {
    const { data, warnings } = await resolveWorktreeOverview(runtimeOptions, args);
    const response = createWorktreeOverviewSuccess(data, warnings);
    logWorktreeOverviewEnd(data);
    return toResponseJson(response);
  } catch (error) {
    return createWorktreeOverviewFailure(error);
  }
}

async function resolveWorktreeOverview(
  runtimeOptions: CreateStateToolsOptions,
  args: WorktreeOverviewArgs,
): Promise<{ data: WorktreeOverviewData; warnings: TreeExpandWarnings }> {
  const resolved = await resolveTreeExpandCore(runtimeOptions, toWorktreeOverviewCoreArgs(args));
  return {
    data: toWorktreeOverviewData(resolved.data),
    warnings: collectTreeExpandWarnings(resolved.warnings, resolved.data),
  };
}

function toWorktreeOverviewCoreArgs(args: WorktreeOverviewArgs): TreeExpandCoreArgs {
  return {
    path: ".",
    base: args.base,
    scope: args.scope ?? "working_tree",
    limit: args.limit,
    max_bytes: args.max_bytes,
    max_depth: args.max_depth,
  };
}

function createWorktreeOverviewSuccess(
  data: WorktreeOverviewData,
  warnings: TreeExpandWarnings,
) {
  return createProvenanceSuccess({
    tool: GW_WORKTREE_OVERVIEW_TOOL,
    mode: "local",
    confidence: getLowestConfidence([
      data.repo.branch.confidence,
      data.summary.changedFiles > 0 ? "high" : "medium",
    ]),
    ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
    bounds: data.bounds.focusAreas,
    summary: buildWorktreeOverviewSummary(data),
    warnings,
    sources: buildWorktreeOverviewSources(data),
    data,
  });
}

function logWorktreeOverviewEnd(data: WorktreeOverviewData): void {
  logger.info("gw_worktree_overview end", {
    tool: GW_WORKTREE_OVERVIEW_TOOL,
    scope: data.scope.type,
    changedFiles: data.summary.changedFiles,
    focusAreas: data.summary.focusAreas,
    staged: data.summary.checkout.staged,
    unstaged: data.summary.checkout.unstaged,
    untracked: data.summary.checkout.untracked,
  });
}

function createWorktreeOverviewFailure(error: unknown): string {
  const message = toErrorMessage(error);
  logger.error("gw_worktree_overview failed", {
    tool: GW_WORKTREE_OVERVIEW_TOOL,
    error: message,
  });
  return createToolFailure({
    tool: GW_WORKTREE_OVERVIEW_TOOL,
    summary: "Failed to summarize the local worktree.",
    code: "WORKTREE_OVERVIEW_FAILED",
    message,
  });
}
