import type {
  CommentLocation,
  CommentState,
  FilterOptions,
  GitHubReviewComment,
  GitHubUser,
  ProcessedComment,
  ProcessedComments,
  RawComments,
  Result,
  ThreadNode,
} from "./pr-comments-types.ts";
import type { CommentFilter } from "./pr-comments-types.ts";

const MAX_THREAD_DEPTH = Number.POSITIVE_INFINITY;
const DEFAULT_AUTHOR = "ghost";

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
