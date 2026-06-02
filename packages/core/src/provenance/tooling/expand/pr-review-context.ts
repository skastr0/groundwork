import {
  DEFAULT_PROVENANCE_BYTE_LIMIT,
  DEFAULT_PROVENANCE_ITEM_LIMIT,
  applyBoundedLimit,
  resolveBoundedNumber,
} from "../args.ts";
import { Effect } from "effect";
import type { CreateStateToolsOptions } from "../state/internal.ts";
import {
  PRCommentsManager,
  type ProcessedComment,
  type ProcessedComments,
  type RawComments,
} from "../../../../../../review/pr-comments.ts";
import { buildBoundedText } from "./pr-bounds.ts";
import { classifyGhFailure } from "./pr-gh.ts";
import { MAX_REVIEW_BODY_BYTES, type PrToolName } from "./pr-types.ts";
import type { PrRemoteReviewContext, PrReviewContextItem } from "./schemas.ts";
import { applyByteBudget } from "./shared.ts";

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

export async function resolveRemoteReviewContext(options: {
  shell: CreateStateToolsOptions["shell"];
  toolName: PrToolName;
  prNumber: number;
  limit: number | undefined;
  maxBytes: number | undefined;
}): Promise<PrRemoteReviewContext> {
  const commentsManager = new PRCommentsManager(options.shell);
  const raw = await Effect.runPromise(commentsManager.fetchAllCommentsEffect(options.prNumber));
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
