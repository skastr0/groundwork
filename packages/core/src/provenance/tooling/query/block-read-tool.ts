import { tool, type ToolDefinition } from "../tool.ts";
import {
  provenanceBaseArg,
  provenanceEndLineArg,
  provenanceLayerArg,
  provenanceLimitArg,
  provenanceMaxBytesArg,
  provenanceModeArg,
  provenancePathArg,
  provenanceRadiusArg,
  provenanceStartLineArg,
  provenanceWindowEndArg,
  provenanceWindowStartArg,
  type ProvenanceContentLayer,
} from "../args.ts";
import {
  resolveLocalSpanLineage,
  type LocalSpanLineageResolution,
} from "../lineage/tool.ts";
import {
  normalizeRequestedPath,
  type LocalFileState,
  type LocalRepoState,
} from "../state/internal.ts";
import {
  createLocalToolFailure,
  createUnsupportedModeFailure,
  toErrorMessage,
} from "../shared.ts";
import { logger } from "../utils/logger.ts";
import { resolveBlockReadContent } from "./block-read-content.ts";
import { serializeBlockReadSuccess } from "./block-read-response.ts";
import { buildLocalDiffContext } from "./diff-context.ts";
import {
  GW_BLOCK_READ_TOOL,
  type ProvBlockDiff,
  type ProvBlockContent,
} from "./schemas.ts";
import {
  createPathNormalizationFailure,
  loadQueryToolState,
  type BlockReadToolInput,
  type QueryToolRuntimeOptions,
} from "./runtime.ts";

type BlockReadSuccessInputs = {
  repoState: LocalRepoState;
  fileState: LocalFileState;
  content: ProvBlockContent;
  lineageResolution: LocalSpanLineageResolution;
  diff: ProvBlockDiff;
};

export function createBlockReadTool(runtimeOptions: QueryToolRuntimeOptions): ToolDefinition {
  return tool({
    description:
      "Read one bounded line window from a file layer with nearby lineage and local diff context.",
    args: {
      path: provenancePathArg,
      start_line: provenanceStartLineArg,
      end_line: provenanceEndLineArg,
      radius: provenanceRadiusArg,
      window_start: provenanceWindowStartArg,
      window_end: provenanceWindowEndArg,
      layer: provenanceLayerArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: provenanceLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    execute: (input: BlockReadToolInput) => executeBlockReadTool(input, runtimeOptions),
  });
}

async function executeBlockReadTool(
  input: BlockReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): Promise<string> {
  const resolvedMode = input.mode ?? "local";
  if (resolvedMode !== "local") {
    return createUnsupportedBlockReadModeFailure(resolvedMode);
  }

  const selectedLayerName = input.layer ?? "worktree";
  const normalizedPath = normalizeBlockReadPath(input, runtimeOptions);
  if (!normalizedPath.success) {
    return normalizedPath.response;
  }

  logBlockReadStart(input, resolvedMode, normalizedPath.path, selectedLayerName);

  try {
    const result = await loadBlockReadSuccessInputs({
      input,
      runtimeOptions,
      normalizedPath: normalizedPath.path,
      selectedLayerName,
    });
    if (typeof result === "string") {
      return result;
    }

    return serializeBlockReadSuccess({
      input,
      normalizedPath: normalizedPath.path,
      ...result,
    });
  } catch (error) {
    return createBlockReadFailure({
      input,
      resolvedMode,
      normalizedPath: normalizedPath.path,
      selectedLayerName,
      error,
    });
  }
}

function createUnsupportedBlockReadModeFailure(mode: string): string {
  logger.warn("gw_block_read unsupported mode", {
    tool: GW_BLOCK_READ_TOOL,
    mode,
  });
  return createUnsupportedModeFailure(GW_BLOCK_READ_TOOL, mode);
}

function normalizeBlockReadPath(
  input: BlockReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): { success: true; path: string } | { success: false; response: string } {
  try {
    return {
      success: true,
      path: normalizeRequestedPath(input.path, runtimeOptions.rootDir),
    };
  } catch (error) {
    return {
      success: false,
      response: createBlockReadPathFailure(input, error),
    };
  }
}

function createBlockReadPathFailure(input: BlockReadToolInput, error: unknown): string {
  return createPathNormalizationFailure({
    tool: GW_BLOCK_READ_TOOL,
    requestedPath: input.path,
    code: "GW_BLOCK_READ_PATH_INVALID",
    error,
  });
}

async function loadBlockReadSuccessInputs(params: {
  input: BlockReadToolInput;
  runtimeOptions: QueryToolRuntimeOptions;
  normalizedPath: string;
  selectedLayerName: ProvenanceContentLayer;
}): Promise<string | BlockReadSuccessInputs> {
  const { input, runtimeOptions, normalizedPath, selectedLayerName } = params;
  const { repoState, fileState } = await loadQueryToolState(
    runtimeOptions,
    normalizedPath,
    input.base,
  );
  const rootDir = runtimeOptions.rootDir ?? process.cwd();
  const contentResult = await resolveBlockReadContent({
    input,
    runtimeOptions,
    rootDir,
    selectedLayerName,
    fileState,
  });
  if (typeof contentResult === "string") {
    return contentResult;
  }

  const { content, selectedLayer } = contentResult;
  const lineageResolution = await resolveLocalSpanLineage({
    shell: runtimeOptions.shell,
    rootDir,
    requestedPath: input.path,
    normalizedPath: selectedLayer.path,
    startLine: content.window.startLine,
    endLine: content.window.endLine,
    limit: input.limit,
  });
  const diff = await buildLocalDiffContext({
    shell: runtimeOptions.shell,
    rootDir,
    fileState,
    selectedLayerName,
    focus: content.focus,
    limit: input.limit,
  });
  return {
    repoState,
    fileState,
    content,
    lineageResolution,
    diff,
  };
}

function createBlockReadFailure(params: {
  input: BlockReadToolInput;
  resolvedMode: string;
  normalizedPath: string;
  selectedLayerName: ProvenanceContentLayer;
  error: unknown;
}): string {
  const errorMessage = toErrorMessage(params.error);
  logger.error("gw_block_read failed", {
    tool: GW_BLOCK_READ_TOOL,
    mode: params.resolvedMode,
    path: params.normalizedPath,
    layer: params.selectedLayerName,
    startLine: params.input.start_line,
    endLine: params.input.end_line,
    error: errorMessage,
  });

  return createLocalToolFailure({
    tool: GW_BLOCK_READ_TOOL,
    summary: `Failed to read block provenance for '${params.normalizedPath}:${params.input.start_line}-${params.input.end_line}'.`,
    code: "GW_BLOCK_READ_UNAVAILABLE",
    message: errorMessage,
  });
}

function logBlockReadStart(
  input: BlockReadToolInput,
  resolvedMode: string,
  normalizedPath: string,
  selectedLayerName: ProvenanceContentLayer,
): void {
  logger.info("gw_block_read start", {
    tool: GW_BLOCK_READ_TOOL,
    mode: resolvedMode,
    path: normalizedPath,
    layer: selectedLayerName,
    startLine: input.start_line,
    endLine: input.end_line,
    radius: input.radius,
    windowStart: input.window_start,
    windowEnd: input.window_end,
    base: input.base,
    limit: input.limit,
    maxBytes: input.max_bytes,
  });
}
