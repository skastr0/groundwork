import type {
  CommentState,
  GraphQLResponse,
  GraphQLReviewThread,
  GraphQLReviewThreadComments,
  GraphQLReviewThreadConnection,
  GraphQLThreadCommentsResponse,
  Result,
  ThreadCommentsPage,
} from "./pr-comments-types.ts";

export const MAX_GRAPHQL_PAGES = 50;

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

const THREAD_COMMENTS_QUERY = `
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

export function createReviewThreadStatesCommand(
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

export function createThreadCommentsCommand(
  threadId: string,
  cursor: string | null,
): readonly [string, ...string[]] {
  const command: [string, ...string[]] = [
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${THREAD_COMMENTS_QUERY}`,
    "-F",
    `id=${threadId}`,
  ];

  if (cursor) {
    command.push("-F", `cursor=${cursor}`);
  }

  return command;
}

export function validateThreadCommentsPageRequest(
  threadId: string,
  cursor: string | null,
  seenCursors: Set<string>,
  pageCount: number,
): Result<void> {
  if (pageCount > MAX_GRAPHQL_PAGES) {
    return {
      success: false,
      error: `GraphQL thread comments pagination exceeded ${MAX_GRAPHQL_PAGES} pages for thread '${threadId}'.`,
    };
  }

  if (cursor && seenCursors.has(cursor)) {
    return {
      success: false,
      error: `GraphQL thread comments pagination repeated cursor '${cursor}' for thread '${threadId}'.`,
    };
  }

  if (cursor) {
    seenCursors.add(cursor);
  }

  return { success: true, data: undefined };
}

export function parseThreadCommentsPage(data: string): Result<ThreadCommentsPage> {
  try {
    const parsed: GraphQLThreadCommentsResponse = JSON.parse(data);
    const comments = parsed.data.node?.comments;
    if (!comments) {
      return { success: true, data: { ids: [], nextCursor: null } };
    }

    return {
      success: true,
      data: {
        ids: collectThreadCommentIds(comments),
        nextCursor: resolveThreadCommentsNextCursor(comments),
      },
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse GraphQL thread comments: ${error}`,
    };
  }
}

function collectThreadCommentIds(comments: GraphQLReviewThreadComments): number[] {
  const ids: number[] = [];
  for (const comment of comments.nodes) {
    if (comment.databaseId == null) continue;
    ids.push(comment.databaseId);
  }
  return ids;
}

function resolveThreadCommentsNextCursor(comments: GraphQLReviewThreadComments): string | null {
  if (!comments.pageInfo.hasNextPage || !comments.pageInfo.endCursor) {
    return null;
  }
  return comments.pageInfo.endCursor;
}

export function parseReviewThreadStatesPage(
  raw: string,
): Result<GraphQLReviewThreadConnection> {
  try {
    const parsed: GraphQLResponse = JSON.parse(raw);
    return { success: true, data: parsed.data.repository.pullRequest.reviewThreads };
  } catch (error) {
    return { success: false, error: `Failed to parse GraphQL: ${error}` };
  }
}

export function createReviewThreadPaginationLimitFailure(prNumber: number): Result<never> {
  return {
    success: false,
    error: `GraphQL review thread pagination exceeded ${MAX_GRAPHQL_PAGES} pages for PR #${prNumber}.`,
  };
}

export function createReviewThreadRepeatedCursorFailure(
  prNumber: number,
  cursor: string,
): Result<never> {
  return {
    success: false,
    error: `GraphQL review thread pagination repeated cursor '${cursor}' for PR #${prNumber}.`,
  };
}

export function collectFirstPageCommentIds(thread: GraphQLReviewThread): Set<number> {
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

export function applyReviewThreadState(
  stateMap: Map<number, CommentState>,
  thread: GraphQLReviewThread,
  commentIds: Iterable<number>,
): void {
  for (const commentId of commentIds) {
    stateMap.set(commentId, toCommentState(thread));
  }
}

export function resolveNextReviewThreadCursor(
  threads: GraphQLReviewThreadConnection,
): string | null {
  if (!threads.pageInfo.hasNextPage || !threads.pageInfo.endCursor) {
    return null;
  }

  return threads.pageInfo.endCursor;
}
