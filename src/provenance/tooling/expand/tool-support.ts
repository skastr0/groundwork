import { type ProvenanceConfidence, type ProvenanceWarning } from "../contracts.ts";
import { logger } from "../utils/logger.ts";
import type { ProvDiffExpandData } from "./schemas.ts";
import {
  createLocalToolFailure,
  createUnsupportedModeFailure,
  dedupeWarnings,
  getLowestConfidence,
} from "./shared.ts";
import {
  GW_COMMIT_EXPAND_TOOL,
  GW_COMMIT_MATERIALIZE_TOOL,
  GW_DIFF_EXPAND_TOOL,
  GW_TREE_EXPAND_TOOL,
  GW_WORKTREE_OVERVIEW_TOOL,
} from "./schemas.ts";

export type ExpandToolName =
  | typeof GW_DIFF_EXPAND_TOOL
  | typeof GW_COMMIT_MATERIALIZE_TOOL
  | typeof GW_COMMIT_EXPAND_TOOL
  | typeof GW_TREE_EXPAND_TOOL
  | typeof GW_WORKTREE_OVERVIEW_TOOL;

export function createToolFailure(options: {
  tool: ExpandToolName;
  summary: string;
  code: string;
  message: string;
}): string {
  return createLocalToolFailure(options);
}

export function resolveLocalMode(
  toolName: ExpandToolName,
  mode: string | undefined,
): string | null {
  const resolvedMode = mode ?? "local";
  if (resolvedMode === "local") {
    return null;
  }

  logger.warn(`${toolName} unsupported mode`, {
    tool: toolName,
    mode: resolvedMode,
  });
  return createUnsupportedModeFailure(toolName, resolvedMode);
}

export function inferDiffExpandConfidence(data: ProvDiffExpandData): ProvenanceConfidence {
  const candidates: ProvenanceConfidence[] = [data.repo.branch.confidence];
  if (data.file) {
    candidates.push(data.file.worktree.confidence);
  }
  if (data.changeSummaries.length === 0) {
    candidates.push("low");
  }
  return getLowestConfidence(candidates);
}

export function collectCommitExpandWarnings(warnings: ProvenanceWarning[]): ProvenanceWarning[] {
  return dedupeWarnings(warnings);
}
