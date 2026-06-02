import {
  createProvenanceFailure,
  type ProvenanceConfidence,
  type ProvenanceEvidenceSource,
  type ProvenanceMode,
  type ProvenanceWarning,
} from "../contracts.ts";
import type { GhFailure, PrToolName } from "./pr-types.ts";
import type {
  ProvPrExpandData,
  ProvPrMaterializeData,
} from "./schemas.ts";
import {
  dedupeWarnings,
  getLowestConfidence,
} from "./shared.ts";

function inferRepoConfidence(
  data: NonNullable<ProvPrMaterializeData["repo"]>,
): ProvenanceConfidence {
  return getLowestConfidence([
    data.branch.confidence,
    data.base.confidence,
    data.head.confidence,
    data.staged.confidence,
    data.unstaged.confidence,
    data.untracked.confidence,
  ]);
}

export function inferMaterializeConfidence(data: ProvPrMaterializeData): ProvenanceConfidence {
  const candidates: ProvenanceConfidence[] = [];

  if (data.repo) {
    candidates.push(inferRepoConfidence(data.repo));
  }

  if (data.localBranch) {
    candidates.push(data.localBranch.confidence);
  }

  if (data.remote.status !== "unsupported") {
    candidates.push(data.remote.confidence);
  }

  return candidates.length > 0 ? getLowestConfidence(candidates) : "unknown";
}

function toRepoWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  if (!data.repo) {
    return [];
  }

  return data.repo.ambiguity.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    ambiguity: issue.level,
  }));
}

function toRemoteFailureWarning(code: string, message: string): ProvenanceWarning {
  return {
    code,
    message,
    ambiguity: code === "PR_NOT_FOUND" || code === "REMOTE_LOOKUP_DISABLED" ? "medium" : "high",
  };
}

function collectLocalBranchWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  const localBranch = data.localBranch;
  if (!localBranch) {
    return [];
  }

  if (localBranch.status === "available" && localBranch.bounds.truncated) {
    return [{
      code: "PR_LOCAL_FILES_TRUNCATED",
      message: `Local branch fallback files were truncated to ${localBranch.bounds.returned}/${localBranch.files.length}.`,
      ambiguity: "low",
    }];
  }

  if (localBranch.status !== "unavailable") {
    return [];
  }

  return [{
    code: localBranch.code,
    message: localBranch.message,
    ambiguity: localBranch.confidence === "unknown" ? "high" : "medium",
  }];
}

function collectAvailableRemoteWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  if (data.remote.status !== "available") {
    return [];
  }

  const warnings: ProvenanceWarning[] = [];
  if (data.remote.description.bounds.truncated) {
    warnings.push({
      code: "PR_DESCRIPTION_TRUNCATED",
      message: `PR description text hit the ${data.remote.description.bounds.limit}-byte budget.`,
      ambiguity: "low",
    });
  }

  if (data.remote.files.status === "available" && data.remote.files.bounds.truncated) {
    warnings.push({
      code: "PR_REMOTE_FILES_TRUNCATED",
      message: `Remote PR files were truncated to ${data.remote.files.bounds.returned}/${data.remote.files.totalFiles}.`,
      ambiguity: "low",
    });
  }

  if (data.remote.files.status === "unavailable") {
    warnings.push(toRemoteFailureWarning(data.remote.files.code, data.remote.files.message));
  }

  return warnings;
}

function collectReviewContextWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  if (data.remote.status !== "available") {
    return [];
  }

  const reviewContext = data.remote.reviewContext;
  if (reviewContext.status !== "available") {
    return [toRemoteFailureWarning(reviewContext.code, reviewContext.message)];
  }

  const warnings: ProvenanceWarning[] = [];
  if (reviewContext.bounds.items.truncated) {
    warnings.push({
      code: "PR_REVIEW_ITEMS_TRUNCATED",
      message: `Review context items were truncated to ${reviewContext.bounds.items.returned}.`,
      ambiguity: "low",
    });
  }

  if (reviewContext.bounds.bytes.truncated) {
    warnings.push({
      code: "PR_REVIEW_BYTES_TRUNCATED",
      message: `Review context summaries hit the ${reviewContext.bounds.bytes.limit}-byte budget.`,
      ambiguity: "low",
    });
  }

  return warnings;
}

function collectRemoteWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  if (data.remote.status === "unsupported" || data.remote.status === "unavailable") {
    return [toRemoteFailureWarning(data.remote.code, data.remote.message)];
  }

  return [
    ...collectAvailableRemoteWarnings(data),
    ...collectReviewContextWarnings(data),
  ];
}

function collectFallbackWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  if (!data.fallback.used || !data.fallback.reason) {
    return [];
  }

  return [{
    code: "PR_LOCAL_FALLBACK_USED",
    message: data.fallback.reason,
    ambiguity: "medium",
  }];
}

export function collectMaterializeWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  return dedupeWarnings([
    ...toRepoWarnings(data),
    ...collectLocalBranchWarnings(data),
    ...collectRemoteWarnings(data),
    ...collectFallbackWarnings(data),
  ]);
}

export function buildMaterializeSummary(data: ProvPrMaterializeData): string {
  const localSummary = !data.localBranch
    ? "local branch context not requested"
    : data.localBranch.status === "available"
      ? `${data.localBranch.files.length} local branch file(s) against ${data.localBranch.baseRef}`
      : "local branch diff unavailable";

  if (data.remote.status === "available") {
    const remoteFilesSummary =
      data.remote.files.status === "available"
        ? `${data.remote.files.items.length}/${data.remote.files.totalFiles} remote file(s)`
        : "remote files unavailable";
    const reviewSummary =
      data.remote.reviewContext.status === "available"
        ? `${data.remote.reviewContext.items.length} review item(s)`
        : "review context unavailable";

    return `Materialized PR #${data.remote.metadata.number}: ${remoteFilesSummary}, ${reviewSummary}, ${localSummary}.`;
  }

  if (data.remote.status === "unavailable") {
    return `Remote PR context unavailable (${data.remote.code}); ${localSummary}.${
      data.fallback.used ? " Local branch fallback is active." : ""
    }`;
  }

  return `Materialized local-only PR fallback: ${localSummary}.`;
}

export function buildMaterializeSources(
  data: ProvPrMaterializeData,
): ProvenanceEvidenceSource[] {
  const sources: ProvenanceEvidenceSource[] = [];

  if (data.remote.status === "available") {
    sources.push({
      kind: "review",
      id: `pr:${data.remote.metadata.number}`,
      ref: data.remote.metadata.url,
      label: `#${data.remote.metadata.number}`,
      detail: data.remote.metadata.title,
    });
  }

  if (data.localBranch?.status === "available") {
    sources.push({
      kind: "git",
      id: "local-branch-diff",
      ref: data.localBranch.baseRef,
      label: data.repo?.branch.name ?? "local branch",
      detail: `${data.localBranch.files.length} changed file(s)`,
    });
  }

  return sources;
}

export function materializeFailure(
  toolName: PrToolName,
  mode: ProvenanceMode,
  summary: string,
  error: GhFailure,
): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: toolName,
      mode,
      confidence: error.confidence,
      ambiguity: error.confidence === "low" ? "medium" : "high",
      summary,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    }),
    null,
    2,
  );
}

export function collectExpandWarnings(data: ProvPrExpandData): ProvenanceWarning[] {
  return dedupeWarnings(collectMaterializeWarnings(data.materialized));
}

export function buildExpandSummary(data: ProvPrExpandData): string {
  const base = buildMaterializeSummary(data.materialized).replace(/^Materialized/, "Expanded");
  return base;
}

export function buildExpandSources(data: ProvPrExpandData): ProvenanceEvidenceSource[] {
  return buildMaterializeSources(data.materialized);
}

export function inferExpandConfidence(data: ProvPrExpandData): ProvenanceConfidence {
  return inferMaterializeConfidence(data.materialized);
}
