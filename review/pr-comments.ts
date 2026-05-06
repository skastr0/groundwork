import { Effect } from "effect";
import { type PluginInput } from "@opencode-ai/plugin";
import { runProcessText } from "../shared/effect-runtime.ts";
import { logger } from "./utils/logger.ts";

export type Shell = PluginInput["$"];

export type Result<T> = { success: true; data: T } | { success: false; error: string };

const GH_COMMAND_TIMEOUT_MS = 20_000;
const MAX_GRAPHQL_PAGES = 50;
const MAX_REVIEW_COMMENT_CONCURRENCY = 8;

const REVIEW_THREAD_STATES_QUERY = `
  query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        reviewThreads(first: 100, after: $cursor) {
          nodes {
            id
            isResolved
            isCollapsed
            outdated
            resolvedBy { login }
            comments(first: 100) {
              nodes { databaseId }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    }
  }
`;

export interface GitHubUser {
  login: string;
}

export interface GitHubReview {
  id: number;
  user: GitHubUser | null;
  body: string | null;
  state: string;
  submitted_at: string | null;
  created_at?: string | null;
}

export interface GitHubReviewComment {
  id: number;
  pull_request_review_id: number | null;
  in_reply_to_id: number | null;
  user: GitHubUser | null;
  body: string | null;
  created_at: string;
  path: string;
  line: number | null;
  start_line: number | null;
  side: string | null;
  diff_hunk: string | null;
}

export interface GitHubIssueComment {
  id: number;
  user: GitHubUser | null;
  body: string | null;
  created_at: string;
}

export interface CommentLocation {
  path: string;
  line?: number;
  start_line?: number;
  side?: string;
  diff_hunk?: string;
}

export interface ProcessedComment {
  id: string;
  type: "review" | "review_comment" | "issue_comment" | "orphan_review_comment";
  github_id: number;
  author: string;
  body: string;
  created_at: string;
  state?: string;
  location?: CommentLocation;
  parent_id?: string;
  children?: ProcessedComment[];
  is_resolved?: boolean;
  is_hidden?: boolean;
  is_outdated?: boolean;
  is_actionable?: boolean;
  resolved_by?: string;
}

export interface CommentState {
  is_resolved: boolean;
  is_hidden: boolean;
  is_outdated: boolean;
  resolved_by?: string;
}

interface GraphQLReviewThreadComments {
  nodes: Array<{ databaseId: number | null }>;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

interface GraphQLReviewThread {
  id: string;
  isResolved: boolean;
  isCollapsed: boolean;
  outdated: boolean;
  resolvedBy?: { login: string } | null;
  comments: GraphQLReviewThreadComments;
}

interface GraphQLReviewThreadConnection {
  nodes: GraphQLReviewThread[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

interface GraphQLResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: GraphQLReviewThreadConnection;
      };
    };
  };
}

interface GraphQLThreadCommentsResponse {
  data: {
    node: {
      comments: GraphQLReviewThreadComments;
    } | null;
  };
}

function createReviewThreadStatesCommand(
  prNumber: number,
  cursor: string | null,
): readonly [string, ...string[]] {
  const command: [string, ...string[]] = [
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${REVIEW_THREAD_STATES_QUERY}`,
    "-f",
    "owner=:owner",
    "-f",
    "repo=:repo",
    "-F",
    `pr=${prNumber}`,
  ];

  if (cursor) {
    command.push("-F", `cursor=${cursor}`);
  }

  return command;
}

function parseReviewThreadStatesPage(raw: string): Result<GraphQLReviewThreadConnection> {
  try {
    const parsed: GraphQLResponse = JSON.parse(raw);
    return { success: true, data: parsed.data.repository.pullRequest.reviewThreads };
  } catch (error) {
    return { success: false, error: `Failed to parse GraphQL: ${error}` };
  }
}

function createReviewThreadPaginationLimitFailure(prNumber: number): Result<never> {
  return {
    success: false,
    error: `GraphQL review thread pagination exceeded ${MAX_GRAPHQL_PAGES} pages for PR #${prNumber}.`,
  };
}

function createReviewThreadRepeatedCursorFailure(
  prNumber: number,
  cursor: string,
): Result<never> {
  return {
    success: false,
    error: `GraphQL review thread pagination repeated cursor '${cursor}' for PR #${prNumber}.`,
  };
}

function collectFirstPageCommentIds(thread: GraphQLReviewThread): Set<number> {
  const commentIds = new Set<number>();

  for (const comment of thread.comments.nodes) {
    if (comment.databaseId == null) continue;
    commentIds.add(comment.databaseId);
  }

  return commentIds;
}

function toCommentState(thread: GraphQLReviewThread): CommentState {
  return {
    is_resolved: thread.isResolved,
    is_hidden: thread.isCollapsed,
    is_outdated: thread.outdated,
    resolved_by: thread.resolvedBy?.login,
  };
}

function applyReviewThreadState(
  stateMap: Map<number, CommentState>,
  thread: GraphQLReviewThread,
  commentIds: Iterable<number>,
): void {
  for (const commentId of commentIds) {
    stateMap.set(commentId, toCommentState(thread));
  }
}

function resolveNextReviewThreadCursor(threads: GraphQLReviewThreadConnection): string | null {
  if (!threads.pageInfo.hasNextPage || !threads.pageInfo.endCursor) {
    return null;
  }

  return threads.pageInfo.endCursor;
}

export interface RawComments {
  reviews: GitHubReview[];
  reviewComments: GitHubReviewComment[];
  issueComments: GitHubIssueComment[];
}

export interface ProcessedComments {
  reviews: ProcessedComment[];
  orphanedReviewComments: ProcessedComment[];
  issueComments: ProcessedComment[];
}

export type CommentFilter = "all" | "reviews" | "issues";

export type FilterMode = "all" | "actionable";

export interface FilterOptions {
  mode?: FilterMode;
}

export function filterProcessedCommentsByType(
  processed: ProcessedComments,
  filter: CommentFilter,
): ProcessedComments {
  if (filter === "reviews") {
    return {
      reviews: processed.reviews,
      orphanedReviewComments: processed.orphanedReviewComments,
      issueComments: [],
    };
  }
  if (filter === "issues") {
    return {
      reviews: [],
      orphanedReviewComments: [],
      issueComments: processed.issueComments,
    };
  }
  return processed;
}

export function filterProcessedComments(
  comments: ProcessedComments,
  options: FilterOptions = {},
): ProcessedComments {
  const { mode = "all" } = options;
  if (mode === "all") {
    return comments;
  }

  const filtered: ProcessedComments = {
    reviews: [],
    orphanedReviewComments: [],
    issueComments: [],
  };

  const shouldInclude = (comment: ProcessedComment): boolean => {
    if (mode === "actionable" && comment.is_actionable === false) return false;
    return true;
  };

  const filterCommentTree = (comment: ProcessedComment): ProcessedComment[] => {
    const filteredChildren = (comment.children || []).flatMap(filterCommentTree);

    if (shouldInclude(comment)) {
      return [
        {
          ...comment,
          children: filteredChildren.length > 0 ? filteredChildren : undefined,
        },
      ];
    }

    if (filteredChildren.length === 0) {
      return [];
    }

    return filteredChildren.map((child) => ({
      ...child,
      parent_id: comment.parent_id,
    }));
  };

  for (const review of comments.reviews) {
    const filteredChildren = (review.children || []).flatMap(filterCommentTree);
    const hasBody = Boolean(review.body.trim());

    if (hasBody || filteredChildren.length > 0) {
      filtered.reviews.push({
        ...review,
        children: filteredChildren.length > 0 ? filteredChildren : undefined,
      });
    }
  }

  filtered.orphanedReviewComments = comments.orphanedReviewComments.flatMap(filterCommentTree);

  filtered.issueComments = comments.issueComments;

  return filtered;
}

export interface ThreadNode {
  comment: GitHubReviewComment;
  children: ThreadNode[];
}

const MAX_THREAD_DEPTH = Number.POSITIVE_INFINITY;
const DEFAULT_AUTHOR = "ghost";

function getAuthor(user: GitHubUser | null | undefined): string {
  return user?.login ?? DEFAULT_AUTHOR;
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortByDate<T>(items: T[], getDate: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => toTimestamp(getDate(a)) - toTimestamp(getDate(b)));
}

export function parseJson<T>(raw: string): Result<T> {
  try {
    return { success: true, data: JSON.parse(raw) as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: `Invalid JSON response: ${message}` };
  }
}

export function groupCommentsByReview(comments: GitHubReviewComment[]): {
  byReviewId: Map<number, GitHubReviewComment[]>;
  orphaned: GitHubReviewComment[];
} {
  const byReviewId = new Map<number, GitHubReviewComment[]>();
  const orphaned: GitHubReviewComment[] = [];

  for (const comment of comments) {
    const reviewId = comment.pull_request_review_id;
    if (!reviewId) {
      orphaned.push(comment);
      continue;
    }
    const group = byReviewId.get(reviewId) ?? [];
    group.push(comment);
    byReviewId.set(reviewId, group);
  }

  return { byReviewId, orphaned };
}

export function buildThreadHierarchy(comments: GitHubReviewComment[]): ThreadNode[] {
  const nodes = new Map<number, ThreadNode>();
  for (const comment of comments) {
    nodes.set(comment.id, { comment, children: [] });
  }

  const roots: ThreadNode[] = [];
  for (const comment of comments) {
    const node = nodes.get(comment.id);
    if (!node) continue;
    const parentId = comment.in_reply_to_id;
    const parentNode = parentId ? nodes.get(parentId) : undefined;
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (items: ThreadNode[]): ThreadNode[] => {
    const sorted = sortByDate(items, (item) => item.comment.created_at);
    for (const item of sorted) {
      item.children = sortNodes(item.children);
    }
    return sorted;
  };

  return sortNodes(roots);
}

function buildLocation(comment: GitHubReviewComment): CommentLocation | undefined {
  if (!comment.path && !comment.diff_hunk) return undefined;
  return {
    path: comment.path,
    line: comment.line ?? undefined,
    start_line: comment.start_line ?? undefined,
    side: comment.side ?? undefined,
    diff_hunk: comment.diff_hunk ?? undefined,
  };
}

function flattenThreads(
  nodes: ThreadNode[],
  options: {
    prefix: string;
    parentId?: string;
    type: ProcessedComment["type"];
    depth: number;
    maxDepth: number;
  },
): ProcessedComment[] {
  const { prefix, parentId, type, depth, maxDepth } = options;
  const results: ProcessedComment[] = [];
  const ordered = sortByDate(nodes, (node) => node.comment.created_at);

  ordered.forEach((node, index) => {
    const id = `${prefix}-${index + 1}`;
    const processed: ProcessedComment = {
      id,
      type,
      github_id: node.comment.id,
      author: getAuthor(node.comment.user),
      body: node.comment.body ?? "",
      created_at: node.comment.created_at,
      location: buildLocation(node.comment),
      parent_id: parentId,
    };

    if (depth < maxDepth && node.children.length > 0) {
      processed.children = flattenThreads(node.children, {
        prefix: id,
        parentId: id,
        type,
        depth: depth + 1,
        maxDepth,
      });
    }

    results.push(processed);
  });

  return results;
}

export function assignHierarchicalIds(input: RawComments): ProcessedComments {
  const sortedReviews = sortByDate(
    input.reviews,
    (review) => review.submitted_at ?? review.created_at,
  );
  const sortedIssueComments = sortByDate(input.issueComments, (comment) => comment.created_at);

  const grouped = groupCommentsByReview(input.reviewComments);
  const reviewIds = new Set(sortedReviews.map((review) => review.id));

  const orphanedComments: GitHubReviewComment[] = [...grouped.orphaned];
  for (const [reviewId, comments] of grouped.byReviewId) {
    if (!reviewIds.has(reviewId)) {
      orphanedComments.push(...comments);
    }
  }

  const processedReviews: ProcessedComment[] = sortedReviews.map((review, index) => {
    const reviewId = `review-${index + 1}`;
    const reviewComments = grouped.byReviewId.get(review.id) ?? [];
    const threadRoots = buildThreadHierarchy(reviewComments);
    const children = flattenThreads(threadRoots, {
      prefix: reviewId,
      parentId: reviewId,
      type: "review_comment",
      depth: 1,
      maxDepth: MAX_THREAD_DEPTH,
    });

    return {
      id: reviewId,
      type: "review",
      github_id: review.id,
      author: getAuthor(review.user),
      body: review.body ?? "",
      created_at: review.submitted_at ?? review.created_at ?? "",
      state: review.state,
      children: children.length > 0 ? children : undefined,
    };
  });

  const orphanThreads = buildThreadHierarchy(orphanedComments);
  const processedOrphans = flattenThreads(orphanThreads, {
    prefix: "orphan",
    parentId: undefined,
    type: "orphan_review_comment",
    depth: 1,
    maxDepth: MAX_THREAD_DEPTH,
  });

  const processedIssueComments = sortedIssueComments.map((comment, index) => ({
    id: `issue-${index + 1}`,
    type: "issue_comment" as const,
    github_id: comment.id,
    author: getAuthor(comment.user),
    body: comment.body ?? "",
    created_at: comment.created_at,
  }));

  return {
    reviews: processedReviews,
    orphanedReviewComments: processedOrphans,
    issueComments: processedIssueComments,
  };
}

export function processComments(raw: RawComments): ProcessedComments {
  return assignHierarchicalIds(raw);
}

function calculateActionable(comment: ProcessedComment): boolean {
  if (comment.is_resolved) return false;
  if (comment.is_hidden) return false;
  if (comment.is_outdated) return false;
  return true;
}

export function mergeCommentStates(
  comments: ProcessedComments,
  states: Map<number, CommentState>,
): ProcessedComments {
  const applyState = (comment: ProcessedComment): void => {
    const state = states.get(comment.github_id);
    if (state) {
      comment.is_resolved = state.is_resolved;
      comment.is_hidden = state.is_hidden;
      comment.is_outdated = state.is_outdated;
      comment.resolved_by = state.resolved_by;
      comment.is_actionable = calculateActionable(comment);
    }
    if (comment.children && comment.children.length > 0) {
      for (const child of comment.children) {
        applyState(child);
      }
    }
  };

  for (const review of comments.reviews) {
    for (const child of review.children ?? []) {
      applyState(child);
    }
  }

  for (const orphan of comments.orphanedReviewComments) {
    applyState(orphan);
  }

  for (const issue of comments.issueComments) {
    issue.is_actionable = true;
  }

  return comments;
}

function flattenProcessed(comments: ProcessedComment[]): ProcessedComment[] {
  const output: ProcessedComment[] = [];
  for (const comment of comments) {
    output.push(comment);
    if (comment.children && comment.children.length > 0) {
      output.push(...flattenProcessed(comment.children));
    }
  }
  return output;
}

function formatCommentLocation(location?: CommentLocation): string {
  if (!location) return "";
  const linePart = location.line ? `:${location.line}` : "";
  const sidePart = location.side ? ` (${location.side})` : "";
  return `\n**Location:** \`${location.path}${linePart}\`${sidePart}`;
}

function formatCommentMarkdown(comment: ProcessedComment): string {
  let output = `#### ${comment.id}\n`;
  output += `**Author:** ${comment.author} | **Created:** ${comment.created_at}\n`;
  if (comment.parent_id) {
    output += `**In reply to:** ${comment.parent_id}\n`;
  }
  if (comment.location) {
    output += formatCommentLocation(comment.location) + "\n";
  }
  if (comment.body.trim()) {
    output += `\n${comment.body.trim()}\n`;
  }
  if (comment.location?.diff_hunk) {
    output += "\n```diff\n";
    output += comment.location.diff_hunk;
    output += "\n```\n";
  }
  output += "\n";
  return output;
}

export function formatMarkdown(
  processed: ProcessedComments,
  options?: { filter?: CommentFilter; filterSummary?: string },
): string {
  const filter = options?.filter ?? "all";
  const includeReviews = filter === "all" || filter === "reviews";
  const includeIssues = filter === "all" || filter === "issues";
  const filterSummary = options?.filterSummary;
  let output = "## PR Comments";
  if (filterSummary) {
    output += ` - ${filterSummary}`;
  }
  output += "\n\n";

  if (includeReviews) {
    output += `### Reviews (${processed.reviews.length})\n\n`;
    if (processed.reviews.length === 0) {
      output += "_No reviews found._\n\n";
    } else {
      for (const review of processed.reviews) {
        output += `#### ${review.id} (${review.state ?? "REVIEW"})\n`;
        output += `**Author:** ${review.author} | **Submitted:** ${review.created_at}\n`;
        if (review.body.trim()) {
          output += `\n${review.body.trim()}\n`;
        }
        output += "\n";
        const flattened = review.children ? flattenProcessed(review.children) : [];
        if (flattened.length === 0) {
          output += "_No inline comments for this review._\n\n";
        } else {
          output += "##### Inline Comments\n\n";
          for (const comment of flattened) {
            output += formatCommentMarkdown(comment);
          }
        }
      }
    }

    output += `### Orphaned Review Comments (${processed.orphanedReviewComments.length})\n\n`;
    if (processed.orphanedReviewComments.length === 0) {
      output += "_No orphaned review comments._\n\n";
    } else {
      const flattened = flattenProcessed(processed.orphanedReviewComments);
      for (const comment of flattened) {
        output += formatCommentMarkdown(comment);
      }
    }
  }

  if (includeIssues) {
    output += `### Discussion Comments (${processed.issueComments.length})\n\n`;
    if (processed.issueComments.length === 0) {
      output += "_No discussion comments found._\n";
    } else {
      for (const comment of processed.issueComments) {
        output += `#### ${comment.id}\n`;
        output += `**Author:** ${comment.author} | **Created:** ${comment.created_at}\n`;
        if (comment.body.trim()) {
          output += `\n${comment.body.trim()}\n`;
        }
        output += "\n";
      }
    }
  }

  return output;
}

export function formatJson(processed: ProcessedComments): string {
  return JSON.stringify(processed, null, 2);
}

export class PRCommentsManager {
  constructor(private $: Shell) {}

  private formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async runCommand(
    command: string,
    cmd: readonly [string, ...string[]],
    context: { tool: string; endpoint: string },
  ): Promise<Result<string>> {
    logger.debug("Executing gh api command", {
      tool: context.tool,
      command,
      endpoint: context.endpoint,
    });

    try {
      const output = await runProcessText({
        shell: this.$,
        cmd,
        timeoutMs: GH_COMMAND_TIMEOUT_MS,
        trim: false,
      });
      return { success: true, data: output };
    } catch (error) {
      const message = this.formatError(error);
      logger.error("gh api command failed", {
        tool: context.tool,
        command,
        endpoint: context.endpoint,
        error: message,
      });
      return { success: false, error: `Error: ${message}` };
    }
  }

  async detectPrNumber(): Promise<Result<number>> {
    const command = "gh pr view --json number --jq '.number'";
    const result = await this.runCommand(
      command,
      ["gh", "pr", "view", "--json", "number", "--jq", ".number"],
      {
        tool: "pr_comments",
        endpoint: "pr view",
      },
    );

    if (!result.success) return result;
    const trimmed = result.data.trim();
    const parsed = Number(trimmed);
    if (!trimmed || Number.isNaN(parsed)) {
      return { success: false, error: "Error: Could not detect PR number." };
    }
    return { success: true, data: parsed };
  }

  async fetchReviews(prNumber: number): Promise<Result<GitHubReview[]>> {
    const endpoint = `repos/:owner/:repo/pulls/${prNumber}/reviews`;
    const command = `gh api --paginate ${endpoint}`;
    const result = await this.runCommand(command, ["gh", "api", "--paginate", endpoint], {
      tool: "pr_comments",
      endpoint,
    });

    if (!result.success) return result;
    return parseJson<GitHubReview[]>(result.data);
  }

  async fetchReviewComments(prNumber: number): Promise<Result<GitHubReviewComment[]>> {
    const endpoint = `repos/:owner/:repo/pulls/${prNumber}/comments`;
    const command = `gh api --paginate ${endpoint}`;
    const result = await this.runCommand(command, ["gh", "api", "--paginate", endpoint], {
      tool: "pr_comments",
      endpoint,
    });

    if (!result.success) return result;
    return parseJson<GitHubReviewComment[]>(result.data);
  }

  async fetchReviewCommentsForReview(
    prNumber: number,
    reviewId: number,
  ): Promise<Result<GitHubReviewComment[]>> {
    const endpoint = `repos/:owner/:repo/pulls/${prNumber}/reviews/${reviewId}/comments`;
    const command = `gh api --paginate ${endpoint}`;
    const result = await this.runCommand(command, ["gh", "api", "--paginate", endpoint], {
      tool: "pr_comments",
      endpoint,
    });

    if (!result.success) return result;
    return parseJson<GitHubReviewComment[]>(result.data);
  }

  async fetchIssueComments(prNumber: number): Promise<Result<GitHubIssueComment[]>> {
    const endpoint = `repos/:owner/:repo/issues/${prNumber}/comments`;
    const command = `gh api --paginate ${endpoint}`;
    const result = await this.runCommand(command, ["gh", "api", "--paginate", endpoint], {
      tool: "pr_comments",
      endpoint,
    });

    if (!result.success) return result;
    return parseJson<GitHubIssueComment[]>(result.data);
  }

  private async fetchThreadCommentIds(
    threadId: string,
    cursor: string | null,
  ): Promise<Result<number[]>> {
    const query = `
      query($id: ID!, $cursor: String) {
        node(id: $id) {
          ... on PullRequestReviewThread {
            comments(first: 100, after: $cursor) {
              nodes { databaseId }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        }
      }
    `;

    const ids: number[] = [];
    const seenCursors = new Set<string>();
    let nextCursor: string | null = cursor;
    let pageCount = 0;

    while (true) {
      pageCount += 1;
      if (pageCount > MAX_GRAPHQL_PAGES) {
        return {
          success: false,
          error: `GraphQL thread comments pagination exceeded ${MAX_GRAPHQL_PAGES} pages for thread '${threadId}'.`,
        };
      }

      if (nextCursor && seenCursors.has(nextCursor)) {
        return {
          success: false,
          error: `GraphQL thread comments pagination repeated cursor '${nextCursor}' for thread '${threadId}'.`,
        };
      }
      if (nextCursor) {
        seenCursors.add(nextCursor);
      }

      const result = await this.runCommand(
        "gh api graphql",
        nextCursor
          ? [
              "gh",
              "api",
              "graphql",
              "-f",
              `query=${query}`,
              "-F",
              `id=${threadId}`,
              "-F",
              `cursor=${nextCursor}`,
            ]
          : ["gh", "api", "graphql", "-f", `query=${query}`, "-F", `id=${threadId}`],
        { tool: "pr_comments", endpoint: "graphql thread comments" },
      );

      if (!result.success) return result;

      try {
        const parsed: GraphQLThreadCommentsResponse = JSON.parse(result.data);
        const comments = parsed.data.node?.comments;
        if (!comments) {
          break;
        }

        for (const comment of comments.nodes) {
          if (comment.databaseId == null) continue;
          ids.push(comment.databaseId);
        }

        if (!comments.pageInfo.hasNextPage || !comments.pageInfo.endCursor) {
          break;
        }

        nextCursor = comments.pageInfo.endCursor;
      } catch (error) {
        return {
          success: false,
          error: `Failed to parse GraphQL thread comments: ${error}`,
        };
      }
    }

    return { success: true, data: ids };
  }

  private async fetchReviewThreadStatesPage(
    prNumber: number,
    cursor: string | null,
  ): Promise<Result<GraphQLReviewThreadConnection>> {
    const result = await this.runCommand(
      "gh api graphql",
      createReviewThreadStatesCommand(prNumber, cursor),
      { tool: "pr_comments", endpoint: "graphql" },
    );

    if (!result.success) return result;
    return parseReviewThreadStatesPage(result.data);
  }

  private async collectReviewThreadCommentIds(thread: GraphQLReviewThread): Promise<Set<number>> {
    const commentIds = collectFirstPageCommentIds(thread);

    if (thread.comments.pageInfo.hasNextPage && thread.comments.pageInfo.endCursor) {
      const extraComments = await this.fetchThreadCommentIds(
        thread.id,
        thread.comments.pageInfo.endCursor,
      );

      if (extraComments.success) {
        for (const id of extraComments.data) {
          commentIds.add(id);
        }
      } else {
        logger.warn("Failed to fetch additional thread comments", {
          thread_id: thread.id,
          error: extraComments.error,
        });
      }
    }

    return commentIds;
  }

  private async applyReviewThreadStates(
    stateMap: Map<number, CommentState>,
    threads: GraphQLReviewThreadConnection,
  ): Promise<void> {
    for (const thread of threads.nodes) {
      const commentIds = await this.collectReviewThreadCommentIds(thread);
      applyReviewThreadState(stateMap, thread, commentIds);
    }
  }

  async fetchCommentStatesViaGraphQL(prNumber: number): Promise<Result<Map<number, CommentState>>> {
    const stateMap = new Map<number, CommentState>();
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    let pageCount = 0;

    while (true) {
      pageCount += 1;
      if (pageCount > MAX_GRAPHQL_PAGES) {
        return createReviewThreadPaginationLimitFailure(prNumber);
      }

      if (cursor && seenCursors.has(cursor)) {
        return createReviewThreadRepeatedCursorFailure(prNumber, cursor);
      }
      if (cursor) {
        seenCursors.add(cursor);
      }

      const threads = await this.fetchReviewThreadStatesPage(prNumber, cursor);
      if (!threads.success) return threads;

      await this.applyReviewThreadStates(stateMap, threads.data);
      const nextCursor = resolveNextReviewThreadCursor(threads.data);
      if (!nextCursor) {
        break;
      }

      cursor = nextCursor;
    }

    return { success: true, data: stateMap };
  }

  async fetchAllComments(prNumber: number): Promise<Result<RawComments>> {
    const reviews = await this.fetchReviews(prNumber);
    if (!reviews.success) {
      return { success: false, error: reviews.error };
    }

    const { reviewCommentResults, issueComments } = await Effect.runPromise(
      Effect.all(
        {
          reviewCommentResults: Effect.forEach(
            reviews.data,
            (review) =>
              Effect.promise(() => this.fetchReviewCommentsForReview(prNumber, review.id)),
            { concurrency: MAX_REVIEW_COMMENT_CONCURRENCY },
          ),
          issueComments: Effect.promise(() => this.fetchIssueComments(prNumber)),
        },
        { concurrency: 2 },
      ),
    );

    const errors = reviewCommentResults
      .filter((result) => !result.success)
      .map((result) => (result.success ? "" : result.error))
      .filter(Boolean);

    if (!issueComments.success) {
      errors.push(issueComments.error);
    }

    if (errors.length > 0) {
      return { success: false, error: errors.join(" | ") };
    }

    const reviewComments = reviewCommentResults
      .filter((result): result is { success: true; data: GitHubReviewComment[] } => result.success)
      .flatMap((result) => result.data);

    return {
      success: true,
      data: {
        reviews: reviews.data,
        reviewComments,
        issueComments: issueComments.success ? issueComments.data : [],
      },
    };
  }

  async fetchProcessedComments(prNumber: number): Promise<Result<ProcessedComments>> {
    const fetchResult = await this.fetchAllComments(prNumber);
    if (!fetchResult.success) return fetchResult;

    const processed = this.processComments(fetchResult.data);
    const statesResult = await this.fetchCommentStatesViaGraphQL(prNumber);
    if (!statesResult.success) {
      logger.warn("Could not fetch comment states via GraphQL", {
        error: statesResult.error,
      });
      return { success: true, data: processed };
    }

    return {
      success: true,
      data: mergeCommentStates(processed, statesResult.data),
    };
  }

  processComments(raw: RawComments): ProcessedComments {
    return processComments(raw);
  }
}
