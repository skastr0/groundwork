import { createProvenanceSuccess } from "../contracts.ts";
import { resolveLocalSpanLineage } from "../lineage/index.ts";
import {
  toProvFileStateData,
  toProvRepoStateData,
  type LocalFileState,
} from "../state/index.ts";
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
import { GW_BLOCK_READ_TOOL, type ProvBlockReadData } from "./schemas.ts";
import { buildBlockReadSummary, toLineageHints } from "./summaries.ts";
import {
  getHighestAmbiguityFromWarnings,
  toAmbiguityWarnings,
  type BlockReadToolInput,
  type ReadToolState,
} from "./runtime.ts";

export function serializeBlockReadSuccess(params: {
  input: BlockReadToolInput;
  normalizedPath: string;
  repoState: ReadToolState["repoState"];
  fileState: LocalFileState;
  content: ProvBlockReadData["content"];
  lineageResolution: Awaited<ReturnType<typeof resolveLocalSpanLineage>>;
  diff: Awaited<ReturnType<typeof buildLocalDiffContext>>;
}): string {
  const { input, normalizedPath, repoState, fileState, content, lineageResolution, diff } = params;
  const data: ProvBlockReadData = {
    requestedPath: input.path.trim(),
    resolvedPath: fileState.resolvedPath,
    repo: toProvRepoStateData(repoState, input.limit),
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
  const warnings = dedupeWarnings([
    ...toAmbiguityWarnings(repoState.ambiguity),
    ...toAmbiguityWarnings(fileState.ambiguity),
    ...createBlockContentWarnings(content),
    ...lineageResolution.warnings,
    ...createDiffWarnings(diff),
  ]);
  const response = createProvenanceSuccess({
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

  return JSON.stringify(response, null, 2);
}
