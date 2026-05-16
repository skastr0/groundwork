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
