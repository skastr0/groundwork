import type { ToolDefinition } from "@opencode-ai/plugin";
import { createExpandTools } from "./tooling/expand/index.ts";
import { createLineageTools } from "./tooling/lineage/index.ts";
import { createQueryTools } from "./tooling/query/index.ts";
import { createScoreTools } from "./tooling/score/index.ts";
import { createStateTools, type CreateStateToolsOptions } from "./tooling/state/index.ts";

export const FRAMEWORK_PROVENANCE_TOOL_IDS = [
  "gw_repo_state",
  "gw_file_state",
  "gw_span_history",
  "gw_diff_expand",
  "gw_commit_materialize",
  "gw_commit_expand",
  "gw_pr_materialize",
  "gw_pr_expand",
  "gw_tree_expand",
  "gw_worktree_overview",
  "gw_hotspots",
  "gw_authority",
  "gw_stability_report",
  "gw_read",
  "gw_block_read",
] as const;

export type FrameworkProvenanceToolID = (typeof FRAMEWORK_PROVENANCE_TOOL_IDS)[number];
export type CreateFrameworkProvenanceToolsOptions = CreateStateToolsOptions;

export function createFrameworkProvenanceTools(
  options: CreateFrameworkProvenanceToolsOptions,
): Record<FrameworkProvenanceToolID, ToolDefinition> {
  return Object.freeze({
    ...createStateTools(options),
    ...createLineageTools(options),
    ...createExpandTools(options),
    ...createScoreTools(options),
    ...createQueryTools(options),
  }) as Record<FrameworkProvenanceToolID, ToolDefinition>;
}
