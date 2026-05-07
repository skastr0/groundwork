import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import {
  provenanceBaseArg,
  provenanceCommitArg,
  provenanceMaxBytesArg,
  provenanceModeArg,
} from "../args.ts";
import {
  createProvenanceSuccess,
  type ProvenanceConfidence,
  type ProvenanceWarning,
} from "../contracts.ts";
import {
  normalizeCreateStateToolsOptions,
  resolveLocalRepoState,
  toProvRepoStateData,
  type CreateStateToolsOptions,
} from "../state/index.ts";
import { logger } from "../utils/logger.ts";
import {
  buildCommitExpandSummary,
  buildCommitMaterializeSummary,
  buildCommitSources,
  materializeCommit,
} from "./commit-expand.ts";
import {
  GW_COMMIT_EXPAND_TOOL,
  GW_COMMIT_MATERIALIZE_TOOL,
  diffSummaryLimitArg,
  includePatchArg,
  type CommitMaterializedData,
  type ProvCommitExpandData,
} from "./schemas.ts";
import {
  collectCommitExpandWarnings,
  createToolFailure,
  resolveLocalMode,
} from "./tool-support.ts";
import {
  dedupeWarnings,
  getHighestAmbiguity,
  getLowestConfidence,
  toErrorMessage,
} from "./shared.ts";

function buildCommitMaterializeResponse(
  data: CommitMaterializedData,
  warnings: ProvenanceWarning[],
) {
  return createProvenanceSuccess({
    tool: GW_COMMIT_MATERIALIZE_TOOL,
    mode: "local",
    confidence: data.patches.length > 0 ? "high" : "medium",
    ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
    summary: buildCommitMaterializeSummary(data),
    warnings,
    sources: buildCommitSources(data),
    data,
  });
}

async function executeCommitExpandCore(
  options: CreateStateToolsOptions,
  args: {
    commit: string;
    base?: string;
    limit?: number;
    max_bytes?: number;
    include_patch?: boolean;
  },
): Promise<{
  repoConfidence: ProvenanceConfidence;
  data: ProvCommitExpandData;
  warnings: ProvenanceWarning[];
}> {
  const [repoState, materialized] = await Promise.all([
    resolveLocalRepoState({
      shell: options.shell,
      explicitBase: args.base,
    }),
    materializeCommit({
      shell: options.shell,
      commitRef: args.commit,
      limit: args.limit,
      maxBytes: args.max_bytes,
      includePatch: args.include_patch ?? false,
    }),
  ]);
  const data: ProvCommitExpandData = {
    repo: toProvRepoStateData(repoState, args.limit),
    materialized: materialized.data,
  };

  return {
    repoConfidence: repoState.confidence,
    data,
    warnings: collectCommitExpandWarnings([...materialized.warnings]),
  };
}

export function createCommitMaterializeTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Materialize one commit into bounded stats, touched files, and patch summaries without emitting raw diffs by default.",
    args: {
      commit: provenanceCommitArg,
      mode: provenanceModeArg,
      limit: diffSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
      include_patch: includePatchArg,
    },
    async execute(args) {
      const unsupported = resolveLocalMode(GW_COMMIT_MATERIALIZE_TOOL, args.mode);
      if (unsupported) {
        return unsupported;
      }

      logger.info("gw_commit_materialize start", {
        tool: GW_COMMIT_MATERIALIZE_TOOL,
        commit: args.commit,
        limit: args.limit,
        maxBytes: args.max_bytes,
        includePatch: args.include_patch ?? false,
      });

      try {
        const materialized = await materializeCommit({
          shell: runtimeOptions.shell,
          commitRef: args.commit,
          limit: args.limit,
          maxBytes: args.max_bytes,
          includePatch: args.include_patch ?? false,
        });
        const response = buildCommitMaterializeResponse(
          materialized.data,
          dedupeWarnings(materialized.warnings),
        );

        logger.info("gw_commit_materialize end", {
          tool: GW_COMMIT_MATERIALIZE_TOOL,
          commit: materialized.data.commit.shortCommit,
          touchedFiles: materialized.data.touchedFiles.length,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("gw_commit_materialize failed", {
          tool: GW_COMMIT_MATERIALIZE_TOOL,
          commit: args.commit,
          error: message,
        });
        return createToolFailure({
          tool: GW_COMMIT_MATERIALIZE_TOOL,
          summary: `Failed to materialize commit '${args.commit}'.`,
          code: "COMMIT_MATERIALIZE_FAILED",
          message,
        });
      }
    },
  });
}

export function createCommitExpandTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Expand one commit with bounded touched-file summaries.",
    args: {
      commit: provenanceCommitArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: diffSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
      include_patch: includePatchArg,
    },
    async execute(args) {
      const unsupported = resolveLocalMode(GW_COMMIT_EXPAND_TOOL, args.mode);
      if (unsupported) {
        return unsupported;
      }

      logger.info("gw_commit_expand start", {
        tool: GW_COMMIT_EXPAND_TOOL,
        commit: args.commit,
        base: args.base,
        limit: args.limit,
        maxBytes: args.max_bytes,
        includePatch: args.include_patch ?? false,
      });

      try {
        const expanded = await executeCommitExpandCore(runtimeOptions, args);
        const response = createProvenanceSuccess({
          tool: GW_COMMIT_EXPAND_TOOL,
          mode: "local",
          confidence: getLowestConfidence([
            expanded.repoConfidence,
            expanded.data.materialized.patches.length > 0 ? "high" : "medium",
          ]),
          ambiguity: getHighestAmbiguity(
            expanded.warnings.map((warning) => warning.ambiguity ?? "low"),
          ),
          summary: buildCommitExpandSummary(expanded.data),
          warnings: expanded.warnings,
          sources: buildCommitSources(expanded.data.materialized),
          data: expanded.data,
        });

        logger.info("gw_commit_expand end", {
          tool: GW_COMMIT_EXPAND_TOOL,
          commit: expanded.data.materialized.commit.shortCommit,
          touchedFiles: expanded.data.materialized.touchedFiles.length,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("gw_commit_expand failed", {
          tool: GW_COMMIT_EXPAND_TOOL,
          commit: args.commit,
          error: message,
        });
        return createToolFailure({
          tool: GW_COMMIT_EXPAND_TOOL,
          summary: `Failed to expand commit '${args.commit}'.`,
          code: "COMMIT_EXPAND_FAILED",
          message,
        });
      }
    },
  });
}
