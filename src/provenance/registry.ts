import type { ToolDefinition } from "@opencode-ai/plugin";
import { createExpandTools } from "./tooling/expand/index.ts";
import { createLineageTools } from "./tooling/lineage/index.ts";
import { createQueryTools } from "./tooling/query/index.ts";
import { createScoreTools } from "./tooling/score/index.ts";
import { createStateTools, type CreateStateToolsOptions } from "./tooling/state/index.ts";

export const FRAMEWORK_PROVENANCE_TOOL_IDS = [
  "prov_repo_state",
  "prov_file_state",
  "prov_span_history",
  "prov_diff_expand",
  "prov_commit_materialize",
  "prov_commit_expand",
  "prov_pr_materialize",
  "prov_pr_expand",
  "prov_tree_expand",
  "prov_worktree_overview",
  "prov_hotspots",
  "prov_authority",
  "prov_stability_report",
  "prov_read",
  "prov_block_read",
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
