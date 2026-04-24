import { runProcessText } from "../../../../shared/effect-runtime.ts";
import { applyBoundedLimit, DEFAULT_PROVENANCE_ITEM_LIMIT } from "../args.ts";
import type { ProvenanceEvidenceSource, ProvenanceWarning } from "../contracts.ts";
import { parseUnifiedDiff } from "./diff-parser.ts";
import { toDiffChangeSummary, toNearbyFileSummary } from "./change-summaries.ts";
import type {
  CommitIdentity,
  CommitMaterializedData,
  LinkedEvidence,
  ProvCommitExpandData,
} from "./schemas.ts";
import { EMPTY_TREE_HASH } from "./shared.ts";
import type { CreateStateToolsOptions } from "../state/index.ts";

const COMMIT_DIFF_PARSE_MAX_OUTPUT_BYTES = 384_000;

async function resolveCommitMetadata(
  shell: CreateStateToolsOptions["shell"],
  commitRef: string,
): Promise<CommitIdentity> {
  const metadataRaw = await runProcessText({
    shell,
    cmd: ["git", "log", "-1", `--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s`, commitRef],
    trim: false,
  });
  const metadataLine = metadataRaw.trim();
  if (!metadataLine) {
    throw new Error(`Commit '${commitRef}' was not found.`);
  }

  const [commit, shortCommit, authorName, authorEmail, authoredAt, summary] =
    metadataLine.split("\u001f");
  if (!commit || !shortCommit || !authorName || !authorEmail || !authoredAt || !summary) {
    throw new Error(`Commit '${commitRef}' metadata was incomplete.`);
  }

  const parentsRaw = await runProcessText({
    shell,
    cmd: ["git", "rev-list", "--parents", "-n", "1", commit],
    trim: false,
  });
  const parentParts = parentsRaw.trim().split(/\s+/).filter(Boolean);
  const parents = parentParts.slice(1);

  return {
    commit,
    shortCommit,
    authorName,
    authorEmail,
    authoredAt,
    summary,
    parents,
    baseRef: parents[0] ?? EMPTY_TREE_HASH,
    merge: parents.length > 1,
    detectionMethod: "git log -1 --format + git rev-list --parents -n 1",
  };
}

function collectCommitWarnings(data: CommitMaterializedData): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [];

  if (data.commit.merge) {
    warnings.push({
      code: "MERGE_COMMIT_FIRST_PARENT",
      message: `Commit '${data.commit.shortCommit}' is a merge commit; materialization uses the first-parent diff against ${data.commit.baseRef}.`,
      ambiguity: "medium",
    });
  }

  if (data.bounds.touchedFiles.truncated) {
    warnings.push({
      code: "COMMIT_TOUCHED_FILES_TRUNCATED",
      message: `Touched files were truncated to ${data.bounds.touchedFiles.returned}/${data.stats.filesChanged}.`,
      ambiguity: "low",
    });
  }

  for (const patch of data.patches) {
    if (patch.patch.hunkBounds.truncated) {
      warnings.push({
        code: "PATCH_HUNKS_TRUNCATED",
        message: `Patch hunk summaries were truncated for '${patch.path}'.`,
        ambiguity: "low",
      });
    }

    if (patch.patch.text.bounds.truncated) {
      warnings.push({
        code: "PATCH_TEXT_TRUNCATED",
        message: `Raw patch text was truncated for '${patch.path}'.`,
        ambiguity: "low",
      });
    }
  }

  return warnings;
}

export async function materializeCommit(options: {
  shell: CreateStateToolsOptions["shell"];
  commitRef: string;
  limit: number | undefined;
  maxBytes: number | undefined;
  includePatch: boolean;
}): Promise<{ data: CommitMaterializedData; warnings: ProvenanceWarning[] }> {
  const commit = await resolveCommitMetadata(options.shell, options.commitRef);
  const diffText = await runProcessText({
    shell: options.shell,
    cmd: [
      "git",
      "diff",
      "--find-renames",
      "--unified=0",
      `${commit.baseRef}..${commit.commit}`,
      "--",
      ".",
    ],
    maxOutputBytes: COMMIT_DIFF_PARSE_MAX_OUTPUT_BYTES,
    trim: false,
  });
  const sections = parseUnifiedDiff(diffText);
  const touchedFilesAll = sections.map((section) =>
    toNearbyFileSummary({
      key: "commit",
      fromRef: commit.baseRef,
      toRef: commit.commit,
      section,
    }),
  );
  const patchesAll = sections.map((section) =>
    toDiffChangeSummary({
      key: "commit",
      fromRef: commit.baseRef,
      toRef: commit.commit,
      section,
      limit: options.limit,
      maxBytes: options.maxBytes,
      includePatch: options.includePatch,
    }),
  );
  const touchedFiles = applyBoundedLimit(
    touchedFilesAll,
    options.limit,
    DEFAULT_PROVENANCE_ITEM_LIMIT,
  );
  const patches = applyBoundedLimit(patchesAll, options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const data: CommitMaterializedData = {
    commit,
    stats: {
      filesChanged: sections.length,
      additions: sections.reduce((sum, section) => sum + section.additions, 0),
      deletions: sections.reduce((sum, section) => sum + section.deletions, 0),
    },
    touchedFiles: touchedFiles.items,
    patches: patches.items,
    bounds: {
      touchedFiles: touchedFiles.bounds,
      patches: patches.bounds,
    },
  };

  return {
    data,
    warnings: collectCommitWarnings(data),
  };
}

export function buildCommitMaterializeSummary(data: CommitMaterializedData): string {
  return `Materialized commit ${data.commit.shortCommit}: ${data.stats.filesChanged} file(s), ${data.stats.additions} addition(s), ${data.stats.deletions} deletion(s), ${data.patches.length} patch summary(ies).`;
}

export function buildCommitExpandSummary(data: ProvCommitExpandData): string {
  const branchLabel = data.repo.branch.name ?? "detached HEAD";
  return `Expanded commit ${data.materialized.commit.shortCommit}: ${data.materialized.touchedFiles.length} touched file(s), ${data.evidence.items.length} linked evidence item(s), repo ${branchLabel}.`;
}

export function buildCommitSources(
  data: CommitMaterializedData,
  evidence?: LinkedEvidence,
): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: data.commit.commit,
      ref: data.commit.commit,
      label: data.commit.shortCommit,
      detail: data.commit.summary,
    },
    {
      kind: "git",
      id: `${data.commit.commit}:base`,
      ref: data.commit.baseRef,
      label: "base",
      detail: data.commit.merge ? "first-parent diff base" : "direct parent diff base",
    },
  ];

  if (!evidence) {
    return sources;
  }

  const seen = new Set(sources.map((source) => `${source.kind}:${source.id}:${source.path ?? ""}`));
  for (const item of evidence.items) {
    const key = `${item.kind}:${item.id}:${item.path}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    sources.push({
      kind: item.kind,
      id: item.id,
      path: item.path,
      label: item.label,
      detail: item.detail,
      ref: item.timestamp,
    });
  }

  return sources;
}
