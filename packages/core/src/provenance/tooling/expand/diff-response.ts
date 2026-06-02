import { applyBoundedLimit, DEFAULT_PROVENANCE_ITEM_LIMIT } from "../args.ts";
import type { ProvenanceEvidenceSource, ProvenanceWarning } from "../contracts.ts";
import {
  resolveLocalRepoState,
  toProvRepoStateData,
  type CreateStateToolsOptions,
  type LocalRepoState,
} from "../state/internal.ts";
import { toDiffChangeSummary, toNearbyFileSummary } from "./change-summaries.ts";
import { getCanonicalPath, parseUnifiedDiff } from "./diff-parser.ts";
import type { ProvDiffExpandData } from "./schemas.ts";

export type ArtifactAnchorResolution = {
  repoState: LocalRepoState;
  data: ProvDiffExpandData;
};

export function collectDiffWarnings(diff: ProvDiffExpandData): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [];

  if (diff.bounds.changeSummaries.truncated) {
    warnings.push({
      code: "DIFF_CHANGE_SUMMARIES_TRUNCATED",
      message: `Direct change summaries were truncated to ${diff.bounds.changeSummaries.returned}.`,
      ambiguity: "low",
    });
  }

  if (diff.bounds.nearbyFiles.truncated) {
    warnings.push({
      code: "DIFF_NEARBY_FILES_TRUNCATED",
      message: `Nearby file summaries were truncated to ${diff.bounds.nearbyFiles.returned}.`,
      ambiguity: "low",
    });
  }

  if (diff.changeSummaries.length === 0) {
    warnings.push({
      code: "DIFF_CHANGE_NOT_FOUND",
      message: "No direct diff sections were found for the requested anchor.",
      ambiguity: "medium",
    });
  }

  for (const change of diff.changeSummaries) {
    if (change.patch.hunkBounds.truncated) {
      warnings.push({
        code: "PATCH_HUNKS_TRUNCATED",
        message: `Patch hunk summaries were truncated for '${change.path}'.`,
        ambiguity: "low",
      });
    }

    if (change.patch.text.bounds.truncated) {
      warnings.push({
        code: "PATCH_TEXT_TRUNCATED",
        message: `Raw patch text was truncated for '${change.path}'.`,
        ambiguity: "low",
      });
    }
  }

  return warnings;
}

export async function resolveDiffArtifactExpand(options: {
  shell: CreateStateToolsOptions["shell"];
  rootDir: string;
  requestedPath: string;
  resolvedPath: string;
  diffText: string;
  base: string | undefined;
  limit: number | undefined;
  maxBytes: number | undefined;
  includePatch: boolean;
}): Promise<ArtifactAnchorResolution> {
  const repoState = await resolveLocalRepoState({
    shell: options.shell,
    explicitBase: options.base,
  });
  const sections = parseUnifiedDiff(options.diffText);
  const changeSummaries = applyBoundedLimit(
    sections.map((section) =>
      toDiffChangeSummary({
        key: "artifact",
        fromRef: null,
        toRef: null,
        section,
        limit: options.limit,
        maxBytes: options.maxBytes,
        includePatch: options.includePatch,
      }),
    ),
    options.limit,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  const nearbyFiles = applyBoundedLimit(
    sections.slice(changeSummaries.items.length).map((section) =>
      toNearbyFileSummary({
        key: "artifact",
        fromRef: null,
        toRef: null,
        section,
      }),
    ),
    options.limit,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  return {
    repoState,
    data: {
      anchor: {
        kind: "diff",
        requestedPath: options.requestedPath,
        resolvedPath: options.resolvedPath,
        mappedPaths: sections.map((section) => getCanonicalPath(section)),
      },
      repo: toProvRepoStateData(repoState, options.limit),
      changeSummaries: changeSummaries.items,
      nearbyFiles: nearbyFiles.items,
      bounds: {
        changeSummaries: changeSummaries.bounds,
        nearbyFiles: nearbyFiles.bounds,
      },
    },
  };
}

export function buildDiffSummary(data: ProvDiffExpandData): string {
  const branchLabel = data.repo.branch.name ?? "detached HEAD";
  return `Expanded ${data.anchor.kind} diff anchor for ${data.anchor.resolvedPath}: ${data.changeSummaries.length} direct change summary(s), ${data.nearbyFiles.length} nearby file(s), repo ${branchLabel}.`;
}

export function buildDiffSources(data: ProvDiffExpandData): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: `diff-anchor:${data.anchor.kind}`,
      path: data.anchor.resolvedPath,
      label: `${data.anchor.kind} anchor`,
      detail: `${data.changeSummaries.length} direct change summary(s)`,
    },
  ];

  return sources;
}
