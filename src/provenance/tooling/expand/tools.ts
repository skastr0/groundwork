import type { ToolDefinition } from "@opencode-ai/plugin";
import { createCommitExpandTool, createCommitMaterializeTool } from "./commit-tools.ts";
import { createDiffExpandTool } from "./diff-tool.ts";
import { createPrExpandTool, createPrMaterializeTool } from "./pr-tools.ts";
import { createTreeExpandTool, createWorktreeOverviewTool } from "./tree-tools.ts";
import {
  GW_COMMIT_EXPAND_TOOL,
  GW_COMMIT_MATERIALIZE_TOOL,
  GW_DIFF_EXPAND_TOOL,
  GW_PR_EXPAND_TOOL,
  GW_PR_MATERIALIZE_TOOL,
  GW_TREE_EXPAND_TOOL,
  GW_WORKTREE_OVERVIEW_TOOL,
} from "./schemas.ts";
import type { CreateStateToolsOptions } from "../state/index.ts";

export function createExpandTools(
  options: CreateStateToolsOptions,
): Record<string, ToolDefinition> {
  return {
    [GW_DIFF_EXPAND_TOOL]: createDiffExpandTool(options),
    [GW_COMMIT_MATERIALIZE_TOOL]: createCommitMaterializeTool(options),
    [GW_COMMIT_EXPAND_TOOL]: createCommitExpandTool(options),
    [GW_PR_MATERIALIZE_TOOL]: createPrMaterializeTool(options),
    [GW_PR_EXPAND_TOOL]: createPrExpandTool(options),
    [GW_TREE_EXPAND_TOOL]: createTreeExpandTool(options),
    [GW_WORKTREE_OVERVIEW_TOOL]: createWorktreeOverviewTool(options),
  };
}
