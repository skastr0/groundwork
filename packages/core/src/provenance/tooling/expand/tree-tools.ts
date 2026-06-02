import { tool, type ToolDefinition } from "../tool.ts";
import {
  provenanceBaseArg,
  provenanceMaxBytesArg,
  provenanceMaxDepthArg,
  provenanceModeArg,
  provenancePathArg,
  provenanceScopeArg,
} from "../args.ts";
import {
  normalizeCreateStateToolsOptions,
  type CreateStateToolsOptions,
} from "../state/internal.ts";
import {
  GW_TREE_EXPAND_TOOL,
  GW_WORKTREE_OVERVIEW_TOOL,
} from "./schemas.ts";
import {
  executeTreeExpandTool,
  executeWorktreeOverviewTool,
} from "./tree-tool-execute.ts";
import { treeSummaryLimitArg } from "./tree-types.ts";

export function createTreeExpandTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Expand one directory or package path into bounded changed-file, focus-area, and commit-activity summaries.",
    args: {
      path: provenancePathArg,
      base: provenanceBaseArg,
      scope: provenanceScopeArg,
      mode: provenanceModeArg,
      limit: treeSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
      max_depth: provenanceMaxDepthArg,
    },
    async execute(args) {
      return executeTreeExpandTool(runtimeOptions, args);
    },
  });
}

export function createWorktreeOverviewTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Summarize the current local worktree into bounded focus areas, changed files, and commit activity.",
    args: {
      base: provenanceBaseArg,
      scope: provenanceScopeArg,
      mode: provenanceModeArg,
      limit: treeSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
      max_depth: provenanceMaxDepthArg,
    },
    async execute(args) {
      return executeWorktreeOverviewTool(runtimeOptions, args);
    },
  });
}
