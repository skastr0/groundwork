import type { ToolDefinition } from "@opencode-ai/plugin";
import { createCommitExpandTool, createCommitMaterializeTool } from "./commit-tools.ts";
import { createDiffExpandTool } from "./diff-tool.ts";
import { createPrExpandTool, createPrMaterializeTool } from "./pr-tools.ts";
import { createTreeExpandTool, createWorktreeOverviewTool } from "./tree-tools.ts";
import {
  PROV_COMMIT_EXPAND_TOOL,
  PROV_COMMIT_MATERIALIZE_TOOL,
  PROV_DIFF_EXPAND_TOOL,
  PROV_PR_EXPAND_TOOL,
  PROV_PR_MATERIALIZE_TOOL,
  PROV_TREE_EXPAND_TOOL,
  PROV_WORKTREE_OVERVIEW_TOOL,
} from "./schemas.ts";
import type { CreateStateToolsOptions } from "../state/index.ts";

export function createExpandTools(
  options: CreateStateToolsOptions,
): Record<string, ToolDefinition> {
  return {
    [PROV_DIFF_EXPAND_TOOL]: createDiffExpandTool(options),
    [PROV_COMMIT_MATERIALIZE_TOOL]: createCommitMaterializeTool(options),
    [PROV_COMMIT_EXPAND_TOOL]: createCommitExpandTool(options),
    [PROV_PR_MATERIALIZE_TOOL]: createPrMaterializeTool(options),
    [PROV_PR_EXPAND_TOOL]: createPrExpandTool(options),
    [PROV_TREE_EXPAND_TOOL]: createTreeExpandTool(options),
    [PROV_WORKTREE_OVERVIEW_TOOL]: createWorktreeOverviewTool(options),
  };
}
