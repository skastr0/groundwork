import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import {
  provenanceBaseArg,
  provenanceLayerArg,
  provenanceLimitArg,
  provenanceMaxBytesArg,
  provenanceModeArg,
  provenancePathArg,
  type ProvenanceContentLayer,
} from "../args.ts";
import { createProvenanceSuccess } from "../contracts.ts";
import {
  normalizeRequestedPath,
  toProvFileStateData,
  toProvRepoStateData,
} from "../state/index.ts";
import {
  createLocalToolFailure,
  createUnsupportedModeFailure,
  dedupeWarnings,
  getHighestAmbiguity,
  getLowestConfidence,
  toErrorMessage,
} from "../shared.ts";
import { logger } from "../utils/logger.ts";
import {
  applyTextBudget,
  buildContentHints,
  buildContentSource,
  createContentWarning,
  getSelectedLayerState,
  readSelectedLayerText,
} from "./content.ts";
import {
  GW_READ_TOOL,
  type ProvReadData,
} from "./schemas.ts";
import { buildReadSummary } from "./summaries.ts";
import {
  createPathNormalizationFailure,
  getHighestAmbiguityFromWarnings,
  loadQueryToolState,
  toAmbiguityWarnings,
  type QueryToolRuntimeOptions,
  type ReadToolInput,
  type ReadToolState,
} from "./runtime.ts";

type ReadToolRequest = {
  input: ReadToolInput;
  resolvedMode: "local";
  selectedLayerName: ProvenanceContentLayer;
  normalizedPath: string;
};

export function createReadTool(runtimeOptions: QueryToolRuntimeOptions): ToolDefinition {
  return tool({
    description:
      "Read one file layer with bounded content plus compact repo and file provenance summaries.",
    args: {
      path: provenancePathArg,
      layer: provenanceLayerArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: provenanceLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    execute: (input: ReadToolInput) => executeReadTool(input, runtimeOptions),
  });
}

async function executeReadTool(
  input: ReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): Promise<string> {
  const request = normalizeReadToolRequest(input, runtimeOptions);
  if (typeof request === "string") {
    return request;
  }

  logReadToolStart(request);

  try {
    const { repoState, fileState } = await loadQueryToolState(
      runtimeOptions,
      request.normalizedPath,
      input.base,
    );
    const content = await buildReadContent({
      runtimeOptions,
      fileState,
      selectedLayerName: request.selectedLayerName,
      maxBytes: input.max_bytes,
    });

    return serializeReadToolSuccess({
      request,
      repoState,
      fileState,
      content,
    });
  } catch (error) {
    return createReadToolFailure(request, error);
  }
}

function normalizeReadToolRequest(
  input: ReadToolInput,
  runtimeOptions: QueryToolRuntimeOptions,
): string | ReadToolRequest {
  const resolvedMode = input.mode ?? "local";

  if (resolvedMode !== "local") {
    logger.warn("gw_read unsupported mode", {
      tool: GW_READ_TOOL,
      mode: resolvedMode,
    });
    return createUnsupportedModeFailure(GW_READ_TOOL, resolvedMode);
  }

  try {
    return {
      input,
      resolvedMode,
      selectedLayerName: input.layer ?? "worktree",
      normalizedPath: normalizeRequestedPath(input.path, runtimeOptions.rootDir),
    };
  } catch (error) {
    return createPathNormalizationFailure({
      tool: GW_READ_TOOL,
      requestedPath: input.path,
      code: "GW_READ_PATH_INVALID",
      error,
    });
  }
}

function logReadToolStart(request: ReadToolRequest): void {
  logger.info("gw_read start", {
    tool: GW_READ_TOOL,
    mode: request.resolvedMode,
    path: request.normalizedPath,
    layer: request.selectedLayerName,
    base: request.input.base,
    limit: request.input.limit,
    maxBytes: request.input.max_bytes,
  });
}

function serializeReadToolSuccess(params: {
  request: ReadToolRequest;
  repoState: ReadToolState["repoState"];
  fileState: ReadToolState["fileState"];
  content: ProvReadData["content"];
}): string {
  const { request, repoState, fileState, content } = params;
  const data = buildReadData({
    requestedPath: request.input.path.trim(),
    repoState,
    fileState,
    content,
    limit: request.input.limit,
  });
  const response = buildReadResponse({ repoState, fileState, content, data });

  logger.info("gw_read end", {
    tool: GW_READ_TOOL,
    confidence: response.meta.confidence,
    ambiguity: response.meta.ambiguity,
    path: request.normalizedPath,
    resolvedPath: data.resolvedPath,
    layer: content.layer,
    exists: content.exists,
    contentBytes: content.bounds.returned,
  });

  return JSON.stringify(response, null, 2);
}

function createReadToolFailure(request: ReadToolRequest, error: unknown): string {
  const errorMessage = toErrorMessage(error);
  logger.error("gw_read failed", {
    tool: GW_READ_TOOL,
    mode: request.resolvedMode,
    path: request.normalizedPath,
    layer: request.selectedLayerName,
    error: errorMessage,
  });

  return createLocalToolFailure({
    tool: GW_READ_TOOL,
    summary: `Failed to read provenance for '${request.normalizedPath}'.`,
    code: "GW_READ_UNAVAILABLE",
    message: errorMessage,
  });
}

async function buildReadContent(options: {
  runtimeOptions: QueryToolRuntimeOptions;
  fileState: ReadToolState["fileState"];
  selectedLayerName: ProvenanceContentLayer;
  maxBytes: number | undefined;
}): Promise<ProvReadData["content"]> {
  const selectedLayer = getSelectedLayerState(options.fileState, options.selectedLayerName);
  const rawText = await readSelectedLayerText({
    shell: options.runtimeOptions.shell,
    rootDir: options.runtimeOptions.rootDir ?? process.cwd(),
    layer: options.selectedLayerName,
    selectedLayer,
  });
  const boundedContent = applyTextBudget(rawText, options.maxBytes);

  return {
    layer: options.selectedLayerName,
    ref: selectedLayer.ref,
    path: selectedLayer.path,
    exists: selectedLayer.exists,
    text: boundedContent.text,
    bounds: boundedContent.bounds,
    byteCount: boundedContent.byteCount,
    hints: buildContentHints({
      layer: options.selectedLayerName,
      selectedLayer,
      bounds: boundedContent.bounds,
      byteCount: boundedContent.byteCount,
    }),
    confidence: selectedLayer.confidence,
    detectionMethod: selectedLayer.detectionMethod,
  };
}

function buildReadData(options: {
  requestedPath: string;
  repoState: ReadToolState["repoState"];
  fileState: ReadToolState["fileState"];
  content: ProvReadData["content"];
  limit: number | undefined;
}): ProvReadData {
  return {
    requestedPath: options.requestedPath,
    resolvedPath: options.fileState.resolvedPath,
    repo: toProvRepoStateData(options.repoState, options.limit),
    file: toProvFileStateData(options.fileState),
    content: options.content,
  };
}

function buildReadResponse(options: {
  repoState: ReadToolState["repoState"];
  fileState: ReadToolState["fileState"];
  content: ProvReadData["content"];
  data: ProvReadData;
}): ReturnType<typeof createProvenanceSuccess<ProvReadData>> {
  const warnings = dedupeWarnings([
    ...toAmbiguityWarnings(options.repoState.ambiguity),
    ...toAmbiguityWarnings(options.fileState.ambiguity),
    ...createContentWarning(options.content),
  ]);

  return createProvenanceSuccess({
    tool: GW_READ_TOOL,
    mode: "local",
    confidence: getLowestConfidence([
      options.repoState.confidence,
      options.fileState.confidence,
      options.content.confidence,
    ]),
    ambiguity: getHighestAmbiguity([
      options.repoState.ambiguity.level,
      options.fileState.ambiguity.level,
      getHighestAmbiguityFromWarnings(warnings),
    ]),
    bounds: options.content.bounds,
    summary: buildReadSummary(options.data),
    warnings,
    sources: [buildContentSource(options.content)],
    data: options.data,
  });
}
