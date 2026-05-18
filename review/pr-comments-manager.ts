import { Effect } from "effect";
import { runProcessText } from "../shared/effect-runtime.ts";
import { logger } from "./utils/logger.ts";
import {
  applyReviewThreadState,
  collectFirstPageCommentIds,
  createReviewThreadPaginationLimitFailure,
  createReviewThreadRepeatedCursorFailure,
  createReviewThreadStatesCommand,
  createThreadCommentsCommand,
  MAX_GRAPHQL_PAGES,
  parseReviewThreadStatesPage,
  parseThreadCommentsPage,
  resolveNextReviewThreadCursor,
  validateThreadCommentsPageRequest,
} from "./pr-comments-graphql.ts";
import {
  mergeCommentStates,
  parseJson,
  processComments,
} from "./pr-comments-processing.ts";
import type {
  CommentState,
  GitHubIssueComment,
  GitHubReview,
  GitHubReviewComment,
  GraphQLReviewThread,
  GraphQLReviewThreadConnection,
  ProcessedComments,
  RawComments,
  Result,
  Shell,
} from "./pr-comments-types.ts";

const GH_COMMAND_TIMEOUT_MS = 20_000;
const MAX_REVIEW_COMMENT_CONCURRENCY = 8;

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

  private async fetchPaginatedJson<T>(endpoint: string): Promise<Result<T>> {
    const command = `gh api --paginate ${endpoint}`;
    const result = await this.runCommand(command, ["gh", "api", "--paginate", endpoint], {
      tool: "pr_comments",
      endpoint,
    });

    if (!result.success) return result;
    return parseJson<T>(result.data);
  }

  private resultEffect<T>(run: () => Promise<Result<T>>): Effect.Effect<Result<T>, never> {
    return Effect.promise(run);
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

  private async fetchThreadCommentIds(
    threadId: string,
    cursor: string | null,
  ): Promise<Result<number[]>> {
    const ids: number[] = [];
    const seenCursors = new Set<string>();
    let nextCursor: string | null = cursor;
    let pageCount = 0;

    while (true) {
      pageCount += 1;
      const pageRequest = validateThreadCommentsPageRequest(
        threadId,
        nextCursor,
        seenCursors,
        pageCount,
      );
      if (!pageRequest.success) return pageRequest;

      const result = await this.runCommand(
        "gh api graphql",
        createThreadCommentsCommand(threadId, nextCursor),
        { tool: "pr_comments", endpoint: "graphql thread comments" },
      );

      if (!result.success) return result;

      const page = parseThreadCommentsPage(result.data);
      if (!page.success) return page;

      ids.push(...page.data.ids);
      if (!page.data.nextCursor) {
        break;
      }
      nextCursor = page.data.nextCursor;
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

  fetchCommentStatesViaGraphQLEffect(
    prNumber: number,
  ): Effect.Effect<Result<Map<number, CommentState>>, never> {
    return this.resultEffect(() => this.fetchCommentStatesViaGraphQL(prNumber));
  }

  private async fetchCommentStatesViaGraphQL(
    prNumber: number,
  ): Promise<Result<Map<number, CommentState>>> {
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

  fetchAllCommentsEffect(prNumber: number): Effect.Effect<Result<RawComments>, never> {
    return this.resultEffect(() => this.fetchAllComments(prNumber));
  }

  private async fetchAllComments(prNumber: number): Promise<Result<RawComments>> {
    const reviews = await this.fetchPaginatedJson<GitHubReview[]>(
      `repos/:owner/:repo/pulls/${prNumber}/reviews`,
    );
    if (!reviews.success) {
      return { success: false, error: reviews.error };
    }

    const { reviewCommentResults, issueComments } = await Effect.runPromise(
      Effect.all(
        {
          reviewCommentResults: Effect.forEach(
            reviews.data,
            (review) =>
              Effect.promise(() =>
                this.fetchPaginatedJson<GitHubReviewComment[]>(
                  `repos/:owner/:repo/pulls/${prNumber}/reviews/${review.id}/comments`,
                ),
              ),
            { concurrency: MAX_REVIEW_COMMENT_CONCURRENCY },
          ),
          issueComments: Effect.promise(() =>
            this.fetchPaginatedJson<GitHubIssueComment[]>(
              `repos/:owner/:repo/issues/${prNumber}/comments`,
            ),
          ),
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

  fetchProcessedCommentsEffect(prNumber: number): Effect.Effect<Result<ProcessedComments>, never> {
    return this.resultEffect(() => this.fetchProcessedComments(prNumber));
  }

  private async fetchProcessedComments(prNumber: number): Promise<Result<ProcessedComments>> {
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
