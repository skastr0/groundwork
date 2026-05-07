import { tool, type ToolDefinition } from "@opencode-ai/plugin";
import { runProcessText } from "../../../../shared/effect-runtime.ts";
import {
  DEFAULT_PROVENANCE_BYTE_LIMIT,
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
  provenanceBaseArg,
  provenanceMaxBytesArg,
  provenanceModeArg,
  resolveBoundedNumber,
} from "../args.ts";
import {
  createProvenanceFailure,
  createProvenanceSuccess,
  type ProvenanceConfidence,
  type ProvenanceEvidenceSource,
  type ProvenanceMode,
  type ProvenanceWarning,
} from "../contracts.ts";
import {
  normalizeCreateStateToolsOptions,
  resolveLocalRepoState,
  toProvRepoStateData,
  type CreateStateToolsOptions,
  type LocalRepoState,
} from "../state/index.ts";
import { logger } from "../utils/logger.ts";
import {
  PRCommentsManager,
  type ProcessedComment,
  type ProcessedComments,
  type RawComments,
} from "../../../../review/pr-comments.ts";
import { toNearbyFileSummary } from "./change-summaries.ts";
import { parseUnifiedDiff } from "./diff-parser.ts";
import {
  GW_PR_EXPAND_TOOL,
  GW_PR_MATERIALIZE_TOOL,
  type BoundedText,
  type PrChangedFile,
  type PrLocalBranchContext,
  type PrRemoteContext,
  type PrRemoteFiles,
  type PrRemoteReviewContext,
  type PrReviewContextItem,
  type ProvPrExpandData,
  type ProvPrMaterializeData,
  diffSummaryLimitArg,
} from "./schemas.ts";
import {
  applyByteBudget,
  dedupeWarnings,
  getHighestAmbiguity,
  getLowestConfidence,
  toErrorMessage,
} from "./shared.ts";

const LOCAL_BRANCH_DIFF_METHOD = "git diff --find-renames --unified=0 <base-ref>..HEAD -- .";
const GH_PR_DETECT_METHOD = "gh pr view --json number --jq '.number'";
const GH_PR_FETCH_METHOD =
  "gh pr view <pr> --json metadata + gh api pulls/<pr>/files + gh api pulls/<pr>/reviews + gh api pulls/<pr>/comments";
const MAX_REVIEW_BODY_BYTES = 400;
const GH_COMMAND_TIMEOUT_MS = 20_000;
const LOCAL_BRANCH_DIFF_TIMEOUT_MS = 15_000;
const PR_REMOTE_PARSE_MAX_OUTPUT_BYTES = 256_000;
const PR_LOCAL_DIFF_PARSE_MAX_OUTPUT_BYTES = 384_000;

const provenancePrNumberArg = tool.schema
  .number()
  .int()
  .positive()
  .optional()
  .describe("Pull request number to inspect (detect current branch PR when omitted)");

type PrToolName = typeof GW_PR_MATERIALIZE_TOOL | typeof GW_PR_EXPAND_TOOL;

type GhFailure = {
  code: string;
  message: string;
  retryable: boolean;
  confidence: ProvenanceConfidence;
};

type GhResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      failure: GhFailure;
    };

type GhPrMetadata = {
  number: number;
  title: string;
  body: string | null;
  url: string;
  state: string;
  isDraft: boolean;
  author: { login: string } | null;
  baseRefName: string;
  headRefName: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type GhPrFile = {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  previous_filename?: string;
};

type RemotePrNumberResolution =
  | {
      success: true;
      requestedNumber: number | null;
      detectionMethod: string;
      prNumber: number;
    }
  | {
      success: false;
      context: PrRemoteContext;
    };

type RemoteMetadataResolution =
  | {
      success: true;
      metadata: GhPrMetadata;
    }
  | {
      success: false;
      context: PrRemoteContext;
    };

function classifyGhFailure(message: string): GhFailure {
  if (
    /gh auth login|not logged into any github hosts|authentication failed|authentication required|set the gh_token|set the github_token/i.test(
      message,
    )
  ) {
    return {
      code: "GH_UNAUTHENTICATED",
      message: `GitHub CLI authentication is unavailable: ${message}`,
      retryable: true,
      confidence: "unknown",
    };
  }

  if (
    /no pull requests found|could not resolve to a pullrequest|pull request not found|no pull request found/i.test(
      message,
    )
  ) {
    return {
      code: "PR_NOT_FOUND",
      message: `Remote PR context is unavailable: ${message}`,
      retryable: false,
      confidence: "low",
    };
  }

  if (/enoent|command not found|no such file or directory/i.test(message)) {
    return {
      code: "GH_UNAVAILABLE",
      message: `GitHub CLI is unavailable: ${message}`,
      retryable: true,
      confidence: "unknown",
    };
  }

  return {
    code: "GH_REMOTE_ERROR",
    message: `GitHub CLI request failed: ${message}`,
    retryable: true,
    confidence: "unknown",
  };
}

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

function buildBoundedText(
  value: string | null | undefined,
  requested: number | undefined,
): BoundedText {
  const text = (value ?? "").trim();
  const limit = resolveBoundedNumber(requested, DEFAULT_PROVENANCE_BYTE_LIMIT);
  const byteCount = Buffer.byteLength(text, "utf8");

  if (byteCount <= limit) {
    return {
      text,
      bounds: {
        requested,
        limit,
        returned: byteCount,
        truncated: false,
      },
      byteCount,
    };
  }

  const suffix = "... [truncated]";
  let end = text.length;
  while (end > 0 && Buffer.byteLength(`${text.slice(0, end)}${suffix}`, "utf8") > limit) {
    end -= 1;
  }

  const truncatedText =
    end > 0 ? `${text.slice(0, end).trimEnd()}${suffix}` : suffix.slice(0, limit);

  return {
    text: truncatedText,
    bounds: {
      requested,
      limit,
      returned: Buffer.byteLength(truncatedText, "utf8"),
      truncated: true,
    },
    byteCount,
  };
}

function normalizeRemoteStatus(status: string): PrChangedFile["status"] {
  switch (status) {
    case "added":
      return "added";
    case "modified":
    case "changed":
      return "modified";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    case "copied":
      return "copied";
    default:
      return "unknown";
  }
}

function toRemoteChangedFile(file: GhPrFile): PrChangedFile {
  return {
    path: file.filename,
    previousPath: file.previous_filename,
    status: normalizeRemoteStatus(file.status),
    additions: Math.max(0, Math.trunc(file.additions ?? 0)),
    deletions: Math.max(0, Math.trunc(file.deletions ?? 0)),
  };
}

function flattenCommentTree(comments: ProcessedComment[]): ProcessedComment[] {
  const output: ProcessedComment[] = [];
  for (const comment of comments) {
    output.push(comment);
    if (comment.children && comment.children.length > 0) {
      output.push(...flattenCommentTree(comment.children));
    }
  }
  return output;
}

function flattenProcessedComments(processed: ProcessedComments): ProcessedComment[] {
  const reviews = processed.reviews.flatMap((review) => {
    const children = review.children ? flattenCommentTree(review.children) : [];
    return [review, ...children];
  });
  const orphans = flattenCommentTree(processed.orphanedReviewComments);
  return [...reviews, ...orphans, ...processed.issueComments];
}

function reviewItemByteSize(item: PrReviewContextItem): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8");
}

function toReviewContextItem(comment: ProcessedComment, maxBytes: number): PrReviewContextItem {
  const bounded = buildBoundedText(comment.body, maxBytes);
  return {
    id: comment.id,
    type: comment.type,
    githubId: comment.github_id,
    author: comment.author,
    createdAt: comment.created_at,
    state: comment.state,
    path: comment.location?.path,
    line: comment.location?.line ?? comment.location?.start_line ?? undefined,
    parentId: comment.parent_id,
    body: bounded.text,
    bodyTruncated: bounded.bounds.truncated,
  };
}

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

async function runGhText(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  command: string;
  cmd: readonly [string, ...string[]];
}): Promise<GhResult<string>> {
  logger.debug("pr gh command start", {
    tool: options.toolName,
    command: options.command,
  });

  try {
    const data = await runProcessText({
      shell: options.shell,
      cmd: options.cmd,
      timeoutMs: GH_COMMAND_TIMEOUT_MS,
      maxOutputBytes: PR_REMOTE_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    });
    return { success: true, data };
  } catch (error) {
    const failure = classifyGhFailure(toErrorMessage(error));
    logger.warn("pr gh command failed", {
      tool: options.toolName,
      command: options.command,
      code: failure.code,
      error: failure.message,
    });
    return { success: false, failure };
  }
}

function parseJsonResult<T>(raw: string, context: string): GhResult<T> {
  try {
    return {
      success: true,
      data: JSON.parse(raw) as T,
    };
  } catch (error) {
    return {
      success: false,
      failure: {
        code: "GH_INVALID_JSON",
        message: `GitHub CLI returned invalid JSON for ${context}: ${toErrorMessage(error)}`,
        retryable: true,
        confidence: "unknown",
      },
    };
  }
}

async function resolveRemoteFiles(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  prNumber: number;
  limit: number | undefined;
}): Promise<PrRemoteFiles> {
  const command = `gh api --paginate repos/:owner/:repo/pulls/${options.prNumber}/files`;
  const result = await runGhText({
    shell: options.shell,
    toolName: options.toolName,
    command,
    cmd: ["gh", "api", "--paginate", `repos/:owner/:repo/pulls/${options.prNumber}/files`],
  });

  if (!result.success) {
    return {
      status: "unavailable",
      code: result.failure.code,
      message: result.failure.message,
    };
  }

  const parsed = parseJsonResult<GhPrFile[]>(
    result.data,
    `pull request #${options.prNumber} files`,
  );
  if (!parsed.success) {
    return {
      status: "unavailable",
      code: parsed.failure.code,
      message: parsed.failure.message,
    };
  }

  const allFiles = parsed.data.map((file) => toRemoteChangedFile(file));
  const bounded = applyBoundedLimit(allFiles, options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);

  return {
    status: "available",
    totalFiles: allFiles.length,
    items: bounded.items,
    bounds: bounded.bounds,
  };
}

function buildReviewStateCounts(raw: RawComments): Array<{ state: string; count: number }> {
  const counts = new Map<string, number>();
  for (const review of raw.reviews) {
    const key = review.state || "COMMENTED";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([state, count]) => ({ state, count }))
    .sort((left, right) => left.state.localeCompare(right.state));
}

async function resolveRemoteReviewContext(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  prNumber: number;
  limit: number | undefined;
  maxBytes: number | undefined;
}): Promise<PrRemoteReviewContext> {
  const commentsManager = new PRCommentsManager(options.shell);
  const raw = await commentsManager.fetchAllComments(options.prNumber);
  if (!raw.success) {
    const failure = classifyGhFailure(raw.error);
    return {
      status: "unavailable",
      code: failure.code,
      message: failure.message,
    };
  }

  const processed = commentsManager.processComments(raw.data);
  const perItemBytes = Math.min(
    MAX_REVIEW_BODY_BYTES,
    resolveBoundedNumber(options.maxBytes, DEFAULT_PROVENANCE_BYTE_LIMIT),
  );
  const itemsAll = flattenProcessedComments(processed).map((comment) =>
    toReviewContextItem(comment, perItemBytes),
  );
  const itemBounded = applyBoundedLimit(itemsAll, options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
  const byteBounded = applyByteBudget(itemBounded.items, options.maxBytes, reviewItemByteSize);

  return {
    status: "available",
    counts: {
      reviews: raw.data.reviews.length,
      reviewComments: raw.data.reviewComments.length,
      issueComments: raw.data.issueComments.length,
      states: buildReviewStateCounts(raw.data),
    },
    items: byteBounded.items,
    bounds: {
      items: {
        requested: options.limit,
        limit: itemBounded.bounds.limit,
        returned: byteBounded.items.length,
        truncated: itemBounded.bounds.truncated || byteBounded.bounds.truncated,
      },
      bytes: byteBounded.bounds,
    },
  };
}

function inferRemoteConfidence(
  files: PrRemoteFiles,
  reviewContext: PrRemoteReviewContext,
): ProvenanceConfidence {
  return files.status === "available" && reviewContext.status === "available" ? "medium" : "low";
}

async function resolveRemoteContext(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  mode: ProvenanceMode;
  pr: number | undefined;
  limit: number | undefined;
  maxBytes: number | undefined;
}): Promise<PrRemoteContext> {
  if (options.mode === "local") {
    return createRemoteLookupDisabledContext(options.pr);
  }

  const prResolution = await resolveRemotePrNumber(options);
  if (!prResolution.success) {
    return prResolution.context;
  }

  const metadataResolution = await resolveRemoteMetadata({
    shell: options.shell,
    toolName: options.toolName,
    requestedNumber: prResolution.requestedNumber,
    detectionMethod: prResolution.detectionMethod,
    prNumber: prResolution.prNumber,
  });
  if (!metadataResolution.success) {
    return metadataResolution.context;
  }

  const files = await resolveRemoteFiles({
    shell: options.shell,
    toolName: options.toolName,
    prNumber: prResolution.prNumber,
    limit: options.limit,
  });
  const reviewContext = await resolveRemoteReviewContext({
    shell: options.shell,
    toolName: options.toolName,
    prNumber: prResolution.prNumber,
    limit: options.limit,
    maxBytes: options.maxBytes,
  });

  return createAvailableRemoteContext({
    metadata: metadataResolution.metadata,
    requestedNumber: prResolution.requestedNumber,
    detectionMethod: prResolution.detectionMethod,
    files,
    reviewContext,
    maxBytes: options.maxBytes,
  });
}

function createRemoteLookupDisabledContext(pr: number | undefined): PrRemoteContext {
  return {
    status: "unsupported",
    attempted: false,
    requestedNumber: pr ?? null,
    resolvedNumber: null,
    detectionMethod: "remote lookup disabled by local mode",
    confidence: "high",
    code: "REMOTE_LOOKUP_DISABLED",
    message: "Remote PR lookup is disabled in local mode.",
  };
}

async function resolveRemotePrNumber(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  pr: number | undefined;
}): Promise<RemotePrNumberResolution> {
  const requestedNumber = options.pr ?? null;
  const detectionMethod = options.pr ? "explicit pr input" : GH_PR_DETECT_METHOD;

  if (options.pr !== undefined) {
    return {
      success: true,
      requestedNumber,
      detectionMethod,
      prNumber: options.pr,
    };
  }

  const detectResult = await runGhText({
    shell: options.shell,
    toolName: options.toolName,
    command: GH_PR_DETECT_METHOD,
    cmd: ["gh", "pr", "view", "--json", "number", "--jq", ".number"],
  });

  if (!detectResult.success) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber,
        resolvedNumber: null,
        detectionMethod,
        failure: detectResult.failure,
      }),
    };
  }

  const parsedNumber = Number(detectResult.data.trim());
  if (!detectResult.data.trim() || Number.isNaN(parsedNumber)) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber,
        resolvedNumber: null,
        detectionMethod,
        failure: {
          confidence: "low",
          code: "PR_NOT_FOUND",
          message:
            "Remote PR context is unavailable: GitHub CLI did not return a pull request number.",
          retryable: false,
        },
      }),
    };
  }

  return {
    success: true,
    requestedNumber,
    detectionMethod,
    prNumber: parsedNumber,
  };
}

async function resolveRemoteMetadata(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  requestedNumber: number | null;
  detectionMethod: string;
  prNumber: number;
}): Promise<RemoteMetadataResolution> {
  const metadataCommand = `gh pr view ${options.prNumber} --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt`;
  const metadataResult = await runGhText({
    shell: options.shell,
    toolName: options.toolName,
    command: metadataCommand,
    cmd: [
      "gh",
      "pr",
      "view",
      String(options.prNumber),
      "--json",
      "number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
    ],
  });

  if (!metadataResult.success) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber: options.requestedNumber,
        resolvedNumber: options.prNumber,
        detectionMethod: options.detectionMethod,
        failure: metadataResult.failure,
      }),
    };
  }

  const parsedMetadata = parseJsonResult<GhPrMetadata>(
    metadataResult.data,
    `pull request #${options.prNumber}`,
  );
  if (!parsedMetadata.success) {
    return {
      success: false,
      context: createUnavailableRemoteContext({
        requestedNumber: options.requestedNumber,
        resolvedNumber: options.prNumber,
        detectionMethod: options.detectionMethod,
        failure: parsedMetadata.failure,
      }),
    };
  }

  return {
    success: true,
    metadata: parsedMetadata.data,
  };
}

function createUnavailableRemoteContext(options: {
  requestedNumber: number | null;
  resolvedNumber: number | null;
  detectionMethod: string;
  failure: GhFailure;
}): PrRemoteContext {
  return {
    status: "unavailable",
    attempted: true,
    requestedNumber: options.requestedNumber,
    resolvedNumber: options.resolvedNumber,
    detectionMethod: options.detectionMethod,
    confidence: options.failure.confidence,
    code: options.failure.code,
    message: options.failure.message,
    retryable: options.failure.retryable,
  };
}

function createAvailableRemoteContext(options: {
  metadata: GhPrMetadata;
  requestedNumber: number | null;
  detectionMethod: string;
  files: PrRemoteFiles;
  reviewContext: PrRemoteReviewContext;
  maxBytes: number | undefined;
}): PrRemoteContext {
  return {
    status: "available",
    attempted: true,
    requestedNumber: options.requestedNumber,
    resolvedNumber: options.metadata.number,
    detectionMethod: `${options.detectionMethod} + ${GH_PR_FETCH_METHOD}`,
    confidence: inferRemoteConfidence(options.files, options.reviewContext),
    metadata: {
      number: options.metadata.number,
      title: options.metadata.title,
      url: options.metadata.url,
      state: options.metadata.state,
      isDraft: options.metadata.isDraft,
      author: options.metadata.author?.login ?? null,
      baseRefName: options.metadata.baseRefName,
      headRefName: options.metadata.headRefName,
      createdAt: options.metadata.createdAt,
      updatedAt: options.metadata.updatedAt,
    },
    description: buildBoundedText(options.metadata.body, options.maxBytes),
    files: options.files,
    reviewContext: options.reviewContext,
  };
}

async function resolveLocalBranchContext(options: {
  shell: CreateStateToolsOptions["shell"];
  repoState: LocalRepoState;
  limit: number | undefined;
}): Promise<PrLocalBranchContext> {
  const baseRef = options.repoState.base.ref;
  if (!baseRef) {
    return {
      status: "unavailable",
      baseRef: null,
      detectionMethod: options.repoState.base.detectionMethod,
      confidence: options.repoState.base.confidence,
      code: "LOCAL_BASE_UNRESOLVED",
      message: "Local branch fallback is unavailable because no local base ref could be resolved.",
      hints: [
        "Provide an explicit base ref if you want deterministic local changed-file fallback.",
      ],
    };
  }

  try {
    const diffText = await runProcessText({
      shell: options.shell,
      cmd: ["git", "diff", "--find-renames", "--unified=0", `${baseRef}..HEAD`, "--", "."],
      timeoutMs: LOCAL_BRANCH_DIFF_TIMEOUT_MS,
      maxOutputBytes: PR_LOCAL_DIFF_PARSE_MAX_OUTPUT_BYTES,
      trim: false,
    });
    const allFiles = toLocalChangedFile(baseRef, diffText);
    const bounded = applyBoundedLimit(allFiles, options.limit, DEFAULT_PROVENANCE_ITEM_LIMIT);
    const hints: string[] = [];

    if (bounded.bounds.truncated) {
      hints.push(
        `Local branch fallback files were truncated to ${bounded.bounds.returned}/${allFiles.length}.`,
      );
    }

    return {
      status: "available",
      baseRef,
      detectionMethod: LOCAL_BRANCH_DIFF_METHOD,
      confidence: getLowestConfidence([
        options.repoState.confidence,
        options.repoState.base.confidence,
      ]),
      files: bounded.items,
      bounds: bounded.bounds,
      hints,
    };
  } catch (error) {
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
}

function resolveFallback(
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

async function materializePrContext(
  options: CreateStateToolsOptions,
  toolName: PrToolName,
  args: {
    pr?: number;
    base?: string;
    mode: ProvenanceMode;
    limit?: number;
    max_bytes?: number;
  },
): Promise<ProvPrMaterializeData> {
  let repo: ProvPrMaterializeData["repo"];
  let localBranch: ProvPrMaterializeData["localBranch"];
  let repoState: LocalRepoState | undefined;

  if (args.mode !== "remote") {
    repoState = await resolveLocalRepoState({
      shell: options.shell,
      explicitBase: args.base,
    });
    repo = toProvRepoStateData(repoState, args.limit);
    localBranch = await resolveLocalBranchContext({
      shell: options.shell,
      repoState,
      limit: args.limit,
    });
  }

  const remote = await resolveRemoteContext({
    shell: options.shell,
    toolName,
    mode: args.mode,
    pr: args.pr,
    limit: args.limit,
    maxBytes: args.max_bytes,
  });

  return {
    repo,
    localBranch,
    remote,
    fallback: resolveFallback(args.mode, localBranch, remote),
  };
}

function inferMaterializeConfidence(data: ProvPrMaterializeData): ProvenanceConfidence {
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

function collectMaterializeWarnings(data: ProvPrMaterializeData): ProvenanceWarning[] {
  const warnings: ProvenanceWarning[] = [...toRepoWarnings(data)];

  if (data.localBranch?.status === "available" && data.localBranch.bounds.truncated) {
    warnings.push({
      code: "PR_LOCAL_FILES_TRUNCATED",
      message: `Local branch fallback files were truncated to ${data.localBranch.bounds.returned}/${data.localBranch.files.length}.`,
      ambiguity: "low",
    });
  }

  if (data.localBranch?.status === "unavailable") {
    warnings.push({
      code: data.localBranch.code,
      message: data.localBranch.message,
      ambiguity: data.localBranch.confidence === "unknown" ? "high" : "medium",
    });
  }

  if (data.remote.status === "unsupported") {
    warnings.push(toRemoteFailureWarning(data.remote.code, data.remote.message));
  }

  if (data.remote.status === "unavailable") {
    warnings.push(toRemoteFailureWarning(data.remote.code, data.remote.message));
  }

  if (data.remote.status === "available") {
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

    if (data.remote.reviewContext.status === "available") {
      if (data.remote.reviewContext.bounds.items.truncated) {
        warnings.push({
          code: "PR_REVIEW_ITEMS_TRUNCATED",
          message: `Review context items were truncated to ${data.remote.reviewContext.bounds.items.returned}.`,
          ambiguity: "low",
        });
      }

      if (data.remote.reviewContext.bounds.bytes.truncated) {
        warnings.push({
          code: "PR_REVIEW_BYTES_TRUNCATED",
          message: `Review context summaries hit the ${data.remote.reviewContext.bounds.bytes.limit}-byte budget.`,
          ambiguity: "low",
        });
      }
    } else {
      warnings.push(
        toRemoteFailureWarning(data.remote.reviewContext.code, data.remote.reviewContext.message),
      );
    }
  }

  if (data.fallback.used && data.fallback.reason) {
    warnings.push({
      code: "PR_LOCAL_FALLBACK_USED",
      message: data.fallback.reason,
      ambiguity: "medium",
    });
  }

  return dedupeWarnings(warnings);
}

function buildMaterializeSummary(data: ProvPrMaterializeData): string {
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

function buildMaterializeSources(data: ProvPrMaterializeData): ProvenanceEvidenceSource[] {
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

function materializeFailure(
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

function collectExpandWarnings(data: ProvPrExpandData): ProvenanceWarning[] {
  return dedupeWarnings(collectMaterializeWarnings(data.materialized));
}

function buildExpandSummary(data: ProvPrExpandData): string {
  const base = buildMaterializeSummary(data.materialized).replace(/^Materialized/, "Expanded");
  return base;
}

function buildExpandSources(data: ProvPrExpandData): ProvenanceEvidenceSource[] {
  return buildMaterializeSources(data.materialized);
}

function inferExpandConfidence(data: ProvPrExpandData): ProvenanceConfidence {
  return inferMaterializeConfidence(data.materialized);
}

export function createPrMaterializeTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Materialize bounded PR context with explicit local fallback, remote gh enrichment, changed files, and review summaries.",
    args: {
      pr: provenancePrNumberArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: diffSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    async execute(args) {
      const mode = args.mode ?? "hybrid";

      logger.info("gw_pr_materialize start", {
        tool: GW_PR_MATERIALIZE_TOOL,
        pr: args.pr,
        base: args.base,
        mode,
        limit: args.limit,
        maxBytes: args.max_bytes,
      });

      try {
        const data = await materializePrContext(runtimeOptions, GW_PR_MATERIALIZE_TOOL, {
          pr: args.pr,
          base: args.base,
          mode,
          limit: args.limit,
          max_bytes: args.max_bytes,
        });

        if (mode === "remote" && data.remote.status === "unavailable") {
          return materializeFailure(
            GW_PR_MATERIALIZE_TOOL,
            mode,
            `Failed to materialize remote PR context${args.pr ? ` for #${args.pr}` : ""}.`,
            {
              code: data.remote.code,
              message: data.remote.message,
              retryable: data.remote.retryable,
              confidence: data.remote.confidence,
            },
          );
        }

        const warnings = collectMaterializeWarnings(data);
        const response = createProvenanceSuccess({
          tool: GW_PR_MATERIALIZE_TOOL,
          mode,
          confidence: inferMaterializeConfidence(data),
          ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
          summary: buildMaterializeSummary(data),
          warnings,
          sources: buildMaterializeSources(data),
          data,
        });

        logger.info("gw_pr_materialize end", {
          tool: GW_PR_MATERIALIZE_TOOL,
          mode,
          remoteStatus: data.remote.status,
          fallback: data.fallback.used,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("gw_pr_materialize failed", {
          tool: GW_PR_MATERIALIZE_TOOL,
          pr: args.pr,
          mode,
          error: message,
        });
        return materializeFailure(
          GW_PR_MATERIALIZE_TOOL,
          mode,
          `Failed to materialize PR context${args.pr ? ` for #${args.pr}` : ""}.`,
          {
            code: "PR_MATERIALIZE_FAILED",
            message,
            retryable: true,
            confidence: "unknown",
          },
        );
      }
    },
  });
}

export function createPrExpandTool(options: CreateStateToolsOptions): ToolDefinition {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return tool({
    description:
      "Expand PR context with explicit local fallback, changed files, and review summaries.",
    args: {
      pr: provenancePrNumberArg,
      base: provenanceBaseArg,
      mode: provenanceModeArg,
      limit: diffSummaryLimitArg,
      max_bytes: provenanceMaxBytesArg,
    },
    async execute(args) {
      const mode = args.mode ?? "hybrid";

      logger.info("gw_pr_expand start", {
        tool: GW_PR_EXPAND_TOOL,
        pr: args.pr,
        base: args.base,
        mode,
        limit: args.limit,
        maxBytes: args.max_bytes,
      });

      try {
        const materialized = await materializePrContext(runtimeOptions, GW_PR_EXPAND_TOOL, {
          pr: args.pr,
          base: args.base,
          mode,
          limit: args.limit,
          max_bytes: args.max_bytes,
        });

        if (mode === "remote" && materialized.remote.status === "unavailable") {
          return materializeFailure(
            GW_PR_EXPAND_TOOL,
            mode,
            `Failed to expand remote PR context${args.pr ? ` for #${args.pr}` : ""}.`,
            {
              code: materialized.remote.code,
              message: materialized.remote.message,
              retryable: materialized.remote.retryable,
              confidence: materialized.remote.confidence,
            },
          );
        }

        const data: ProvPrExpandData = {
          materialized,
        };

        const warnings = collectExpandWarnings(data);
        const response = createProvenanceSuccess({
          tool: GW_PR_EXPAND_TOOL,
          mode,
          confidence: inferExpandConfidence(data),
          ambiguity: getHighestAmbiguity(warnings.map((warning) => warning.ambiguity ?? "low")),
          summary: buildExpandSummary(data),
          warnings,
          sources: buildExpandSources(data),
          data,
        });

        logger.info("gw_pr_expand end", {
          tool: GW_PR_EXPAND_TOOL,
          mode,
          remoteStatus: materialized.remote.status,
          fallback: materialized.fallback.used,
        });

        return JSON.stringify(response, null, 2);
      } catch (error) {
        const message = toErrorMessage(error);
        logger.error("gw_pr_expand failed", {
          tool: GW_PR_EXPAND_TOOL,
          pr: args.pr,
          mode,
          error: message,
        });
        return materializeFailure(
          GW_PR_EXPAND_TOOL,
          mode,
          `Failed to expand PR context${args.pr ? ` for #${args.pr}` : ""}.`,
          {
            code: "PR_EXPAND_FAILED",
            message,
            retryable: true,
            confidence: "unknown",
          },
        );
      }
    },
  });
}
