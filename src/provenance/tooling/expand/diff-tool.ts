import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import {
  provenanceBaseArg,
  provenanceMaxBytesArg,
  provenanceMaxItemsArg,
  provenanceModeArg,
  provenancePathArg,
} from "../args.ts";
import { createProvenanceSuccess } from "../contracts.ts";
import { logger } from "../utils/logger.ts";
import {
  buildDiffSources,
  buildDiffSummary,
  collectDiffWarnings,
  resolveDiffAnchor,
  resolveDiffArtifactExpand,
  resolveFileAnchorDiff,
} from "./diff-expand.ts";
import {
  PROV_DIFF_EXPAND_TOOL,
  diffSummaryLimitArg,
  includePatchArg,
  type ProvDiffExpandData,
} from "./schemas.ts";
import { createToolFailure, inferDiffExpandConfidence, resolveLocalMode } from "./tool-support.ts";
import { dedupeWarnings, getHighestAmbiguity, toErrorMessage } from "./shared.ts";
import { normalizeCreateStateToolsOptions, type CreateStateToolsOptions } from "../state/index.ts";

async function executeDiffExpandCore(
  options: CreateStateToolsOptions,
  args: {
    path: string;
    base?: string;
    limit?: number;
    max_items?: number;
    max_bytes?: number;
    include_patch?: boolean;
  },
): Promise<ProvDiffExpandData> {
  const rootDir = options.rootDir ?? process.cwd();
  const anchor = await resolveDiffAnchor({
    rootDir,
    requestedPath: args.path,
  });

  if (anchor.kind === "diff") {
    return (
      await resolveDiffArtifactExpand({
        shell: options.shell,
        rootDir,
        requestedPath: args.path,
        resolvedPath: anchor.resolvedPath,
        diffText: anchor.diffText ?? "",
        base: args.base,
        limit: args.limit,
        maxItems: args.max_items,
        maxBytes: args.max_bytes,
        includePatch: args.include_patch ?? false,
      })
    ).data;
  }

  return (
    await resolveFileAnchorDiff({
      shell: options.shell,
      rootDir,
      requestedPath: anchor.resolvedPath,
      base: args.base,
      limit: args.limit,
      maxItems: args.max_items,
      maxBytes: args.max_bytes,
      includePatch: args.include_patch ?? false,
    })
  ).data;
}

export function createDiffExpandTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Expand one file or diff anchor into bounded change summaries, nearby files, and linked provenance evidence.",
    args: {
      path: provenancePathArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: diffSummaryLimitArg,
      max_items: provenanceMaxItemsArg,
      max_bytes: provenanceMaxBytesArg,
      include_patch: includePatchArg,
    },
    async execute(args) {
      const unsupported = resolveLocalMode(PROV_DIFF_EXPAND_TOOL, args.mode);
      if (unsupported) {
        return unsupported;
      }

      logger.info("prov_diff_expand start", {
        tool: PROV_DIFF_EXPAND_TOOL,
        path: args.path,
        base: args.base,
        limit: args.limit,
        maxItems: args.max_items,
        maxBytes: args.max_bytes,
        includePatch: args.include_patch ?? false,
      });

      try {
        const data = await executeDiffExpandCore(runtimeOptions, args);
        const warnings = dedupeWarnings(collectDiffWarnings(data));
        const response = createProvenanceSuccess({
          tool: PROV_DIFF_EXPAND_TOOL,
          mode: "local",
          confidence: inferDiffExpandConfidence(data),
          ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
          summary: buildDiffSummary(data),
          warnings,
          sources: buildDiffSources(data),
          data,
        });

        logger.info("prov_diff_expand end", {
          tool: PROV_DIFF_EXPAND_TOOL,
          anchorKind: data.anchor.kind,
          changes: data.changeSummaries.length,
          nearby: data.nearbyFiles.length,
          evidence: data.evidence.items.length,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("prov_diff_expand failed", {
          tool: PROV_DIFF_EXPAND_TOOL,
          path: args.path,
          error: message,
        });
        return createToolFailure({
          tool: PROV_DIFF_EXPAND_TOOL,
          summary: `Failed to expand diff anchor '${args.path}'.`,
          code: "DIFF_EXPAND_FAILED",
          message,
        });
      }
    },
  });
}
