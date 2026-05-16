import type {
  CommentFilter,
  CommentLocation,
  ProcessedComment,
  ProcessedComments,
} from "./pr-comments-types.ts";

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

function createMarkdownPlan(options?: {
  filter?: CommentFilter;
  filterSummary?: string;
}): {
  includeReviews: boolean;
  includeIssues: boolean;
  filterSummary?: string;
} {
  const filter = options?.filter ?? "all";
  return {
    includeReviews: filter === "all" || filter === "reviews",
    includeIssues: filter === "all" || filter === "issues",
    filterSummary: options?.filterSummary,
  };
}

function formatMarkdownHeader(filterSummary?: string): string {
  let output = "## PR Comments";
  if (filterSummary) {
    output += ` - ${filterSummary}`;
  }
  return `${output}\n\n`;
}

function formatReviewSections(
  reviews: ProcessedComment[],
  orphanedReviewComments: ProcessedComment[],
): string {
  return (
    formatReviewsSection(reviews) + formatOrphanedReviewCommentsSection(orphanedReviewComments)
  );
}

function formatReviewsSection(reviews: ProcessedComment[]): string {
  let output = `### Reviews (${reviews.length})\n\n`;
  if (reviews.length === 0) {
    return output + "_No reviews found._\n\n";
  }

  for (const review of reviews) {
    output += formatReviewMarkdown(review);
  }
  return output;
}

function formatReviewMarkdown(review: ProcessedComment): string {
  let output = `#### ${review.id} (${review.state ?? "REVIEW"})\n`;
  output += `**Author:** ${review.author} | **Submitted:** ${review.created_at}\n`;
  if (review.body.trim()) {
    output += `\n${review.body.trim()}\n`;
  }
  output += "\n";

  const flattened = review.children ? flattenProcessed(review.children) : [];
  if (flattened.length === 0) {
    return output + "_No inline comments for this review._\n\n";
  }

  output += "##### Inline Comments\n\n";
  for (const comment of flattened) {
    output += formatCommentMarkdown(comment);
  }
  return output;
}

function formatOrphanedReviewCommentsSection(comments: ProcessedComment[]): string {
  let output = `### Orphaned Review Comments (${comments.length})\n\n`;
  if (comments.length === 0) {
    return output + "_No orphaned review comments._\n\n";
  }

  for (const comment of flattenProcessed(comments)) {
    output += formatCommentMarkdown(comment);
  }
  return output;
}

function formatDiscussionCommentsSection(comments: ProcessedComment[]): string {
  let output = `### Discussion Comments (${comments.length})\n\n`;
  if (comments.length === 0) {
    return output + "_No discussion comments found._\n";
  }

  for (const comment of comments) {
    output += formatDiscussionCommentMarkdown(comment);
  }
  return output;
}

function formatDiscussionCommentMarkdown(comment: ProcessedComment): string {
  let output = `#### ${comment.id}\n`;
  output += `**Author:** ${comment.author} | **Created:** ${comment.created_at}\n`;
  if (comment.body.trim()) {
    output += `\n${comment.body.trim()}\n`;
  }
  output += "\n";
  return output;
}

export function formatMarkdown(
  processed: ProcessedComments,
  options?: { filter?: CommentFilter; filterSummary?: string },
): string {
  const plan = createMarkdownPlan(options);
  let output = formatMarkdownHeader(plan.filterSummary);
  if (plan.includeReviews) {
    output += formatReviewSections(processed.reviews, processed.orphanedReviewComments);
  }
  if (plan.includeIssues) {
    output += formatDiscussionCommentsSection(processed.issueComments);
  }
  return output;
}

export function formatJson(processed: ProcessedComments): string {
  return JSON.stringify(processed, null, 2);
}
