import type { ProvenanceContentLayer } from "../args.ts";
import type { ProvenanceAmbiguity, ProvenanceWarning } from "../contracts.ts";
import {
  resolveLocalFileState,
  resolveLocalRepoState,
  type CreateStateToolsOptions,
  type LocalRepoAmbiguityState,
} from "../state/internal.ts";
import {
  createLocalToolFailure,
  getHighestAmbiguity,
  toErrorMessage,
} from "../shared.ts";
import type { QueryToolName } from "./schemas.ts";

export type QueryToolRuntimeOptions = CreateStateToolsOptions;

export interface ReadToolInput {
  path: string;
  layer?: ProvenanceContentLayer;
  base?: string;
  mode?: string;
  limit?: number;
  max_bytes?: number;
}

export interface BlockReadToolInput extends ReadToolInput {
  start_line: number;
  end_line: number;
  radius?: number;
  window_start?: number;
  window_end?: number;
}

export type ReadToolState = {
  repoState: Awaited<ReturnType<typeof resolveLocalRepoState>>;
  fileState: Awaited<ReturnType<typeof resolveLocalFileState>>;
};

export function getHighestAmbiguityFromWarnings(
  warnings: readonly ProvenanceWarning[],
): ProvenanceAmbiguity {
  return getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low"));
}

export function toAmbiguityWarnings(ambiguity: LocalRepoAmbiguityState): ProvenanceWarning[] {
  return ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
}

export function createPathNormalizationFailure(options: {
  tool: QueryToolName;
  requestedPath: string;
  code: string;
  error: unknown;
}): string {
  return createLocalToolFailure({
    tool: options.tool,
    summary: `Failed to normalize path '${options.requestedPath}'.`,
    code: options.code,
    message: toErrorMessage(options.error),
  });
}

export async function loadQueryToolState(
  runtimeOptions: QueryToolRuntimeOptions,
  normalizedPath: string,
  base: string | undefined,
): Promise<ReadToolState> {
  const [repoState, fileState] = await Promise.all([
    resolveLocalRepoState({
      shell: runtimeOptions.shell,
      explicitBase: base,
    }),
    resolveLocalFileState({
      shell: runtimeOptions.shell,
      requestedPath: normalizedPath,
      explicitBase: base,
    }),
  ]);

  return { repoState, fileState };
}
