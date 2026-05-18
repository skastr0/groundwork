import { runProcessText } from "../../../../shared/effect-runtime.ts";
import {
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
} from "../args.ts";
import type { ProvenanceMode } from "../contracts.ts";
import type { CreateStateToolsOptions, LocalRepoState } from "../state/index.ts";
import { toNearbyFileSummary } from "./change-summaries.ts";
import { parseUnifiedDiff } from "./diff-parser.ts";
import {
  LOCAL_BRANCH_DIFF_METHOD,
  LOCAL_BRANCH_DIFF_TIMEOUT_MS,
  PR_LOCAL_DIFF_PARSE_MAX_OUTPUT_BYTES,
} from "./pr-types.ts";
import type {
  PrChangedFile,
  PrLocalBranchContext,
  PrRemoteContext,
  ProvPrMaterializeData,
} from "./schemas.ts";
import { getLowestConfidence, toErrorMessage } from "./shared.ts";

function toLocalChangedFile(baseRef: string, diffText: string): PrChangedFile[] {
  return parseUnifiedDiff(diffText).map((section) => {
    const nearby = toNearbyFileSummary({
      key: "base_to_head",
      fromRef: baseRef,
      toRef: "HEAD",
      section,
    });

    return {
      path: nearby.path,
      previousPath: nearby.oldPath,
      status: nearby.status,
      additions: nearby.additions,
      deletions: nearby.deletions,
    };
  });
}

export async function resolveLocalBranchContext(options: {
  shell: CreateStateToolsOptions["shell"];
  repoState: LocalRepoState;
  limit: number | undefined;
}): Promise<PrLocalBranchContext> {
  const baseRef = options.repoState.base.ref;
  if (!baseRef) {
    return createMissingLocalBaseContext(options.repoState);
  }

  try {
    const diffText = await runProcessText({
      shell: options.shell,
      cmd: ["git", "diff", "--find-renames", "--unified=0", `${baseRef}..HEAD`, "--", "."],
      timeoutMs: LOCAL_BRANCH_DIFF_TIMEOUT_MS,
      maxOutputBytes: PR_LOCAL_DIFF_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    });
    return createAvailableLocalBranchContext({
      repoState: options.repoState,
      baseRef,
      diffText,
      limit: options.limit,
    });
  } catch (error) {
    return createLocalBranchFailureContext(baseRef, error);
  }
}

function createMissingLocalBaseContext(repoState: LocalRepoState): PrLocalBranchContext {
  return {
    status: "unavailable",
    baseRef: null,
    detectionMethod: repoState.base.detectionMethod,
    confidence: repoState.base.confidence,
    code: "LOCAL_BASE_UNRESOLVED",
    message: "Local branch fallback is unavailable because no local base ref could be resolved.",
    hints: [
      "Provide an explicit base ref if you want deterministic local changed-file fallback.",
    ],
  };
}

function createAvailableLocalBranchContext(options: {
  repoState: LocalRepoState;
  baseRef: string;
  diffText: string;
  limit: number | undefined;
}): PrLocalBranchContext {
  const allFiles = toLocalChangedFile(options.baseRef, options.diffText);
  const bounded = applyBoundedLimit(allFiles, options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  return {
    status: "available",
    baseRef: options.baseRef,
    detectionMethod: LOCAL_BRANCH_DIFF_METHOD,
    confidence: getLowestConfidence([
      options.repoState.confidence,
      options.repoState.base.confidence,
    ]),
    files: bounded.items,
    bounds: bounded.bounds,
    hints: buildLocalBranchHints(bounded.bounds.truncated, bounded.bounds.returned, allFiles.length),
  };
}

function buildLocalBranchHints(truncated: boolean, returned: number, total: number): string[] {
  if (!truncated) {
    return [];
  }

  return [`Local branch fallback files were truncated to ${returned}/${total}.`];
}

function createLocalBranchFailureContext(
  baseRef: string,
  error: unknown,
): PrLocalBranchContext {
  return {
    status: "unavailable",
    baseRef,
    detectionMethod: LOCAL_BRANCH_DIFF_METHOD,
    confidence: "low",
    code: "LOCAL_BRANCH_DIFF_FAILED",
    message: `Local branch fallback failed: ${toErrorMessage(error)}`,
    hints: [],
  };
}

export function resolveFallback(
  mode: ProvenanceMode,
  localBranch: PrLocalBranchContext | undefined,
  remote: PrRemoteContext,
): ProvPrMaterializeData["fallback"] {
  if (mode === "local") {
    return {
      used: localBranch?.status === "available",
      kind: localBranch?.status === "available" ? "local_branch" : "none",
      reason:
        localBranch?.status === "available"
          ? `Remote lookup is disabled; using local branch diff against ${localBranch.baseRef}.`
          : "Remote lookup is disabled and no local branch diff fallback was available.",
    };
  }

  if (mode === "hybrid" && remote.status === "unavailable" && localBranch?.status === "available") {
    return {
      used: true,
      kind: "local_branch",
      reason: `Remote PR context is unavailable (${remote.code}); using local branch diff against ${localBranch.baseRef}.`,
    };
  }

  return {
    used: false,
    kind: "none",
  };
}
