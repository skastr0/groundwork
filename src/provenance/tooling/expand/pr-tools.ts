import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import {
  provenanceBaseArg,
  provenanceMaxBytesArg,
  provenanceModeArg,
} from "../args.ts";
import {
  normalizeCreateStateToolsOptions,
  type CreateStateToolsOptions,
} from "../state/index.ts";
import {
  executePrExpandTool,
  executePrMaterializeTool,
} from "./pr-tool-execute.ts";
import {
  GW_PR_EXPAND_TOOL,
  GW_PR_MATERIALIZE_TOOL,
  diffSummaryLimitArg,
} from "./schemas.ts";

const provenancePrNumberArg = tool.schema
  .number()
  .int()
  .positive()
  .optional()
  .describe("Pull request number to inspect (detect current branch PR when omitted)");

export function createPrMaterializeTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Materialize bounded PR context with explicit local fallback, remote gh enrichment, changed files, and review summaries.",
    args: {
      pr: provenancePrNumberArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: diffSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    async execute(args) {
      return executePrMaterializeTool(runtimeOptions, args);
    },
  });
}

export function createPrExpandTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Expand PR context with explicit local fallback, changed files, and review summaries.",
    args: {
      pr: provenancePrNumberArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: diffSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    async execute(args) {
      return executePrExpandTool(runtimeOptions, args);
    },
  });
}
