import {
  type ProvenanceEvidenceSource,
  type ProvenanceWarning,
} from "../contracts.ts";
import {
  dedupeWarnings,
} from "./shared.ts";
import type {
  ProvTreeExpandData,
  ProvWorktreeOverviewData,
  TreeCommitActivity,
  TreeScopeType,
} from "./schemas.ts";

export function buildTreeSources(data: ProvTreeExpandData): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: `tree:${data.anchor.resolvedPath}`,
      path: data.anchor.resolvedPath,
      label: `${data.anchor.kind} anchor`,
      detail: `${data.summary.changedFiles} changed file(s) in ${data.scope.type} scope`,
    },
  ];

  if (data.commits.available && data.commits.range) {
    sources.push({
      kind: "git",
      id: `tree-commits:${data.commits.range}`,
      ref: data.commits.range,
      label: "commit activity",
      detail: `${data.commits.count} commit(s)`,
    });
  }

  return sources;
}

export function buildWorktreeOverviewSources(
  data: ProvWorktreeOverviewData,
): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [
    {
      kind: "git",
      id: `worktree:${data.scope.type}`,
      ref: data.scope.baseRef ?? data.scope.type,
      label: "worktree overview",
      detail: `${data.summary.changedFiles} changed file(s), ${data.summary.focusAreas} focus area(s)`,
    },
  ];

  if (data.commits.available && data.commits.range) {
    sources.push({
      kind: "git",
      id: `worktree-commits:${data.commits.range}`,
      ref: data.commits.range,
      label: "commit activity",
      detail: `${data.commits.count} commit(s)`,
    });
  }

  return sources;
}

function collectTreeWarnings(data: {
  scope: TreeScopeType;
  summary: ProvTreeExpandData["summary"];
  bounds: ProvTreeExpandData["bounds"];
  commits: TreeCommitActivity;
  warnings: ProvenanceWarning[];
}): ProvenanceWarning[] {
  const output = [...data.warnings];

  if (data.summary.changedFiles === 0) {
    output.push({
      code: "TREE_SCOPE_EMPTY",
      message: `No changed files matched the requested ${data.scope} scope.`,
      ambiguity: "low",
    });
  }

  if (data.bounds.areas.truncated) {
    output.push({
      code: "TREE_AREAS_TRUNCATED",
      message: `Tree area summaries were truncated to ${data.bounds.areas.returned} item(s).`,
      ambiguity: "low",
    });
  }

  if (data.bounds.files.truncated) {
    output.push({
      code: "TREE_FILES_TRUNCATED",
      message: `Tree file summaries were truncated to ${data.bounds.files.returned} item(s).`,
      ambiguity: "low",
    });
  }

  if (!data.commits.available) {
    output.push({
      code: "TREE_COMMIT_ACTIVITY_UNAVAILABLE",
      message: data.commits.hints[0] ?? "Commit activity is unavailable for the requested scope.",
      ambiguity: data.scope === "branch" ? "medium" : "low",
    });
  }

  if (data.commits.bounds.truncated) {
    output.push({
      code: "TREE_COMMITS_TRUNCATED",
      message: `Commit activity was truncated to ${data.commits.bounds.returned}/${data.commits.count} commit(s).`,
      ambiguity: "low",
    });
  }

  return dedupeWarnings(output);
}

export function collectTreeExpandWarnings(
  warnings: ProvenanceWarning[],
  data: ProvTreeExpandData,
): ProvenanceWarning[] {
  return collectTreeWarnings({
    scope: data.scope.type,
    summary: data.summary,
    bounds: data.bounds,
    commits: data.commits,
    warnings,
  });
}

export function toWorktreeOverviewData(data: ProvTreeExpandData): ProvWorktreeOverviewData {
  return {
    scope: data.scope,
    repo: data.repo,
    summary: {
      focusAreas: data.summary.areas,
      changedFiles: data.summary.changedFiles,
      additions: data.summary.additions,
      deletions: data.summary.deletions,
      commits: data.summary.commits,
      checkout: data.summary.checkout,
    },
    focusAreas: data.areas,
    files: data.files,
    commits: data.commits,
    bounds: {
      focusAreas: data.bounds.areas,
      files: data.bounds.files,
    },
  };
}

export function buildTreeExpandSummary(data: ProvTreeExpandData): string {
  const anchorLabel = data.anchor.resolvedPath === "." ? "repo root" : data.anchor.resolvedPath;
  return `Expanded ${anchorLabel} in ${data.scope.type} scope: ${data.summary.changedFiles} changed file(s), ${data.summary.areas} focus area(s), ${data.summary.commits} commit(s).`;
}

export function buildWorktreeOverviewSummary(data: ProvWorktreeOverviewData): string {
  return `Worktree overview for ${data.scope.type} scope: ${data.summary.changedFiles} changed file(s), ${data.summary.focusAreas} focus area(s), ${data.summary.checkout.staged} staged, ${data.summary.checkout.unstaged} unstaged, ${data.summary.checkout.untracked} untracked.`;
}
