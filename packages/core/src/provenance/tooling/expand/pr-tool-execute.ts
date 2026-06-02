import {
  createProvenanceSuccess,
  type ProvenanceMode,
} from "../contracts.ts";
import type { CreateStateToolsOptions } from "../state/internal.ts";
import { logger } from "../utils/logger.ts";
import { materializePrContext } from "./pr-materialize.ts";
import {
  buildExpandSources,
  buildExpandSummary,
  buildMaterializeSources,
  buildMaterializeSummary,
  collectExpandWarnings,
  collectMaterializeWarnings,
  inferExpandConfidence,
  inferMaterializeConfidence,
  materializeFailure,
} from "./pr-response.ts";
import {
  GW_PR_EXPAND_TOOL,
  GW_PR_MATERIALIZE_TOOL,
  type ProvPrExpandData,
  type ProvPrMaterializeData,
} from "./schemas.ts";
import {
  getHighestAmbiguity,
  toErrorMessage,
} from "./shared.ts";

type PrToolArgs = {
  pr?: number;
  base?: string;
  mode?: ProvenanceMode;
  limit?: number;
  max_bytes?: number;
};

function toResponseJson(response: unknown): string {
  return JSON.stringify(response, null, 2);
}

function materializeRemoteFailure(
  mode: ProvenanceMode,
  args: PrToolArgs,
  data: ProvPrMaterializeData,
): string {
  if (data.remote.status !== "unavailable") {
    return "";
  }

  return materializeFailure(
    GW_PR_MATERIALIZE_TOOL,
    mode,
    `Failed to materialize remote PR context${args.pr ? ` for #${args.pr}` : ""}.`,
    {
      code: data.remote.code,
      message: data.remote.message,
      retryable: data.remote.retryable,
      confidence: data.remote.confidence,
    },
  );
}

function expandRemoteFailure(
  mode: ProvenanceMode,
  args: PrToolArgs,
  data: ProvPrMaterializeData,
): string {
  if (data.remote.status !== "unavailable") {
    return "";
  }

  return materializeFailure(
    GW_PR_EXPAND_TOOL,
    mode,
    `Failed to expand remote PR context${args.pr ? ` for #${args.pr}` : ""}.`,
    {
      code: data.remote.code,
      message: data.remote.message,
      retryable: data.remote.retryable,
      confidence: data.remote.confidence,
    },
  );
}

function materializeSuccess(mode: ProvenanceMode, data: ProvPrMaterializeData): string {
  const warnings = collectMaterializeWarnings(data);
  return toResponseJson(
    createProvenanceSuccess({
      tool: GW_PR_MATERIALIZE_TOOL,
      mode,
      confidence: inferMaterializeConfidence(data),
      ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
      summary: buildMaterializeSummary(data),
      warnings,
      sources: buildMaterializeSources(data),
      data,
    }),
  );
}

function expandSuccess(mode: ProvenanceMode, materialized: ProvPrMaterializeData): string {
  const data: ProvPrExpandData = { materialized };
  const warnings = collectExpandWarnings(data);
  return toResponseJson(
    createProvenanceSuccess({
      tool: GW_PR_EXPAND_TOOL,
      mode,
      confidence: inferExpandConfidence(data),
      ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
      summary: buildExpandSummary(data),
      warnings,
      sources: buildExpandSources(data),
      data,
    }),
  );
}

function genericFailure(options: {
  toolName: typeof GW_PR_MATERIALIZE_TOOL | typeof GW_PR_EXPAND_TOOL;
  mode: ProvenanceMode;
  args: PrToolArgs;
  code: "PR_MATERIALIZE_FAILED" | "PR_EXPAND_FAILED";
  verb: "materialize" | "expand";
  message: string;
}): string {
  return materializeFailure(
    options.toolName,
    options.mode,
    `Failed to ${options.verb} PR context${options.args.pr ? ` for #${options.args.pr}` : ""}.`,
    {
      code: options.code,
      message: options.message,
      retryable: true,
      confidence: "unknown",
    },
  );
}

export async function executePrMaterializeTool(
  runtimeOptions: CreateStateToolsOptions,
  args: PrToolArgs,
): Promise<string> {
  const mode = args.mode ?? "hybrid";
  logger.info("gw_pr_materialize start", {
    tool: GW_PR_MATERIALIZE_TOOL,
    pr: args.pr,
    base: args.base,
    mode,
    limit: args.limit,
    maxBytes: args.max_bytes,
  });

  try {
    const data = await materializePrContext(runtimeOptions, GW_PR_MATERIALIZE_TOOL, {
      pr: args.pr,
      base: args.base,
      mode,
      limit: args.limit,
      max_bytes: args.max_bytes,
    });
    if (mode === "remote" && data.remote.status === "unavailable") {
      return materializeRemoteFailure(mode, args, data);
    }
    logger.info("gw_pr_materialize end", {
      tool: GW_PR_MATERIALIZE_TOOL,
      mode,
      remoteStatus: data.remote.status,
      fallback: data.fallback.used,
    });
    return materializeSuccess(mode, data);
  } catch (error) {
    const message = toErrorMessage(error);
    logger.error("gw_pr_materialize failed", {
      tool: GW_PR_MATERIALIZE_TOOL,
      pr: args.pr,
      mode,
      error: message,
    });
    return genericFailure({
      toolName: GW_PR_MATERIALIZE_TOOL,
      mode,
      args,
      code: "PR_MATERIALIZE_FAILED",
      verb: "materialize",
      message,
    });
  }
}

export async function executePrExpandTool(
  runtimeOptions: CreateStateToolsOptions,
  args: PrToolArgs,
): Promise<string> {
  const mode = args.mode ?? "hybrid";
  logger.info("gw_pr_expand start", {
    tool: GW_PR_EXPAND_TOOL,
    pr: args.pr,
    base: args.base,
    mode,
    limit: args.limit,
    maxBytes: args.max_bytes,
  });

  try {
    const materialized = await materializePrContext(runtimeOptions, GW_PR_EXPAND_TOOL, {
      pr: args.pr,
      base: args.base,
      mode,
      limit: args.limit,
      max_bytes: args.max_bytes,
    });
    if (mode === "remote" && materialized.remote.status === "unavailable") {
      return expandRemoteFailure(mode, args, materialized);
    }
    logger.info("gw_pr_expand end", {
      tool: GW_PR_EXPAND_TOOL,
      mode,
      remoteStatus: materialized.remote.status,
      fallback: materialized.fallback.used,
    });
    return expandSuccess(mode, materialized);
  } catch (error) {
    const message = toErrorMessage(error);
    logger.error("gw_pr_expand failed", {
      tool: GW_PR_EXPAND_TOOL,
      pr: args.pr,
      mode,
      error: message,
    });
    return genericFailure({
      toolName: GW_PR_EXPAND_TOOL,
      mode,
      args,
      code: "PR_EXPAND_FAILED",
      verb: "expand",
      message,
    });
  }
}
