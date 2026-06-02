import { createProvenanceSuccess } from "../contracts.ts";
import { resolveLocalSpanLineage } from "../lineage/tool.ts";
import {
  toProvFileStateData,
  toProvRepoStateData,
  type LocalFileState,
} from "../state/internal.ts";
import {
  dedupeWarnings,
  getHighestAmbiguity,
  getLowestConfidence,
} from "../shared.ts";
import { logger } from "../utils/logger.ts";
import {
  buildBlockContentSource,
  createBlockContentWarnings,
} from "./content.ts";
import { buildLocalDiffContext, createDiffWarnings } from "./diff-context.ts";
import {
  GW_BLOCK_READ_TOOL,
  type ProvBlockContent,
  type ProvBlockReadData,
} from "./schemas.ts";
import { buildBlockReadSummary, toLineageHints } from "./summaries.ts";
import {
  getHighestAmbiguityFromWarnings,
  toAmbiguityWarnings,
  type BlockReadToolInput,
  type ReadToolState,
} from "./runtime.ts";

type BlockReadLineageResolution = Awaited<ReturnType<typeof resolveLocalSpanLineage>>;
type BlockReadDiffContext = Awaited<ReturnType<typeof buildLocalDiffContext>>;
type BlockReadWarnings = ReturnType<typeof buildBlockReadWarnings>;

interface BlockReadSuccessParams {
  input: BlockReadToolInput;
  normalizedPath: string;
  repoState: ReadToolState["repoState"];
  fileState: LocalFileState;
  content: ProvBlockContent;
  lineageResolution: BlockReadLineageResolution;
  diff: BlockReadDiffContext;
}

export function serializeBlockReadSuccess(params: BlockReadSuccessParams): string {
  const { normalizedPath, repoState, fileState, content, lineageResolution, diff } = params;
  const data = buildBlockReadData(params);
  const warnings = buildBlockReadWarnings({
    repoState,
    fileState,
    content,
    lineageResolution,
    diff,
  });
  const response = createBlockReadSuccessResponse({
    repoState,
    fileState,
    content,
    lineageResolution,
    data,
    warnings,
  });
  logBlockReadEnd({ response, normalizedPath, data, content, diff });
  return JSON.stringify(response, null, 2);
}

function buildBlockReadData(params: BlockReadSuccessParams): ProvBlockReadData {
  const { input, fileState, content, lineageResolution, diff } = params;
  const data: ProvBlockReadData = {
    requestedPath: input.path.trim(),
    resolvedPath: fileState.resolvedPath,
    repo: toProvRepoStateData(params.repoState, input.limit),
    file: toProvFileStateData(fileState),
    content,
    lineage: {
      data: lineageResolution.data,
      bounds: lineageResolution.bounds,
      hints: toLineageHints({
        warnings: lineageResolution.warnings,
        bounds: lineageResolution.bounds,
      }),
      confidence: lineageResolution.confidence,
    },
    diff,
  };
  return data;
}

function buildBlockReadWarnings(params: {
  repoState: ReadToolState["repoState"];
  fileState: LocalFileState;
  content: ProvBlockContent;
  lineageResolution: BlockReadLineageResolution;
  diff: BlockReadDiffContext;
}) {
  const { repoState, fileState, content, lineageResolution, diff } = params;
  return dedupeWarnings([
    ...toAmbiguityWarnings(repoState.ambiguity),
    ...toAmbiguityWarnings(fileState.ambiguity),
    ...createBlockContentWarnings(content),
    ...lineageResolution.warnings,
    ...createDiffWarnings(diff),
  ]);
}

function createBlockReadSuccessResponse(params: {
  repoState: ReadToolState["repoState"];
  fileState: LocalFileState;
  content: ProvBlockContent;
  lineageResolution: BlockReadLineageResolution;
  data: ProvBlockReadData;
  warnings: BlockReadWarnings;
}) {
  const { repoState, fileState, content, lineageResolution, data, warnings } = params;
  return createProvenanceSuccess({
    tool: GW_BLOCK_READ_TOOL,
    mode: "local",
    confidence: getLowestConfidence([
      repoState.confidence,
      fileState.confidence,
      content.confidence,
      data.lineage.confidence,
    ]),
    ambiguity: getHighestAmbiguity([
      repoState.ambiguity.level,
      fileState.ambiguity.level,
      getHighestAmbiguityFromWarnings(warnings),
    ]),
    bounds: content.bounds,
    summary: buildBlockReadSummary(data),
    warnings,
    sources: [buildBlockContentSource(content), ...lineageResolution.sources],
    data,
  });
}

function logBlockReadEnd(params: {
  response: ReturnType<typeof createBlockReadSuccessResponse>;
  normalizedPath: string;
  data: ProvBlockReadData;
  content: ProvBlockContent;
  diff: BlockReadDiffContext;
}): void {
  const { response, normalizedPath, data, content, diff } = params;
  logger.info("gw_block_read end", {
    tool: GW_BLOCK_READ_TOOL,
    confidence: response.meta.confidence,
    ambiguity: response.meta.ambiguity,
    path: normalizedPath,
    resolvedPath: data.resolvedPath,
    layer: content.layer,
    focusStartLine: content.focus.startLine,
    focusEndLine: content.focus.endLine,
    returnedLines: content.lines.length,
    lineageItems: data.lineage.data.lineage.length,
    diffComparisons: diff.comparisons.length,
  });
}
