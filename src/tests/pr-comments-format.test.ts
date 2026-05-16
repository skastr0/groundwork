import { describe, expect, it } from "vitest";
import { formatMarkdown, type ProcessedComments } from "../../review/pr-comments.ts";

const processedComments: ProcessedComments = {
  reviews: [
    {
      id: "review-1",
      type: "review",
      github_id: 1,
      author: "reviewer",
      body: "  Review body  ",
      created_at: "2026-05-01T10:00:00Z",
      state: "APPROVED",
      children: [
        {
          id: "review-1.1",
          type: "review_comment",
          github_id: 2,
          author: "reviewer",
          body: "  Inline body  ",
          created_at: "2026-05-01T10:01:00Z",
          location: {
            path: "src/example.ts",
            line: 7,
            side: "RIGHT",
            diff_hunk: "@@ -1 +1\n-old\n+new",
          },
          children: [
            {
              id: "review-1.1.1",
              type: "review_comment",
              github_id: 3,
              author: "author",
              body: "Reply body",
              created_at: "2026-05-01T10:02:00Z",
              parent_id: "review-1.1",
            },
          ],
        },
      ],
    },
  ],
  orphanedReviewComments: [
    {
      id: "orphan-1",
      type: "orphan_review_comment",
      github_id: 4,
      author: "reviewer",
      body: "Orphan body",
      created_at: "2026-05-01T10:03:00Z",
      location: {
        path: "src/orphan.ts",
        line: 12,
      },
    },
  ],
  issueComments: [
    {
      id: "discussion-1",
      type: "issue_comment",
      github_id: 5,
      author: "maintainer",
      body: "  Discussion body  ",
      created_at: "2026-05-01T10:04:00Z",
    },
  ],
};

describe("formatMarkdown", () => {
  it("formats reviews, flattened inline comments, orphaned comments, and discussion comments", () => {
    const markdown = formatMarkdown(processedComments);

    expect(markdown).toContain("## PR Comments\n\n");
    expect(markdown).toContain("### Reviews (1)\n\n");
    expect(markdown).toContain("#### review-1 (APPROVED)");
    expect(markdown).toContain("Review body");
    expect(markdown).not.toContain("  Review body  ");
    expect(markdown).toContain("##### Inline Comments\n\n");
    expect(markdown).toContain("#### review-1.1\n");
    expect(markdown).toContain("**Location:** `src/example.ts:7` (RIGHT)");
    expect(markdown).toContain("```diff\n@@ -1 +1\n-old\n+new\n```");
    expect(markdown).toContain("#### review-1.1.1\n");
    expect(markdown).toContain("**In reply to:** review-1.1");
    expect(markdown).toContain("### Orphaned Review Comments (1)\n\n");
    expect(markdown).toContain("**Location:** `src/orphan.ts:12`");
    expect(markdown).toContain("### Discussion Comments (1)\n\n");
    expect(markdown).toContain("Discussion body");
    expect(markdown).not.toContain("  Discussion body  ");
  });

  it("honors issue-only filtering and filter summaries", () => {
    const markdown = formatMarkdown(processedComments, {
      filter: "issues",
      filterSummary: "discussion only",
    });

    expect(markdown).toBe(
      "## PR Comments - discussion only\n\n" +
        "### Discussion Comments (1)\n\n" +
        "#### discussion-1\n" +
        "**Author:** maintainer | **Created:** 2026-05-01T10:04:00Z\n" +
        "\nDiscussion body\n" +
        "\n",
    );
  });

  it("preserves empty review-section placeholders", () => {
    const markdown = formatMarkdown(
      {
        reviews: [],
        orphanedReviewComments: [],
        issueComments: [],
      },
      { filter: "reviews" },
    );

    expect(markdown).toBe(
      "## PR Comments\n\n" +
        "### Reviews (0)\n\n" +
        "_No reviews found._\n\n" +
        "### Orphaned Review Comments (0)\n\n" +
        "_No orphaned review comments._\n\n",
    );
  });

  it("preserves review no-inline placeholder output", () => {
    const markdown = formatMarkdown(
      {
        reviews: [
          {
            id: "review-empty",
            type: "review",
            github_id: 6,
            author: "reviewer",
            body: "",
            created_at: "2026-05-01T10:05:00Z",
          },
        ],
        orphanedReviewComments: [],
        issueComments: [],
      },
      { filter: "reviews" },
    );

    expect(markdown).toBe(
      "## PR Comments\n\n" +
        "### Reviews (1)\n\n" +
        "#### review-empty (REVIEW)\n" +
        "**Author:** reviewer | **Submitted:** 2026-05-01T10:05:00Z\n" +
        "\n" +
        "_No inline comments for this review._\n\n" +
        "### Orphaned Review Comments (0)\n\n" +
        "_No orphaned review comments._\n\n",
    );
  });

  it("preserves issue-only empty discussion placeholder output", () => {
    const markdown = formatMarkdown(
      {
        reviews: [],
        orphanedReviewComments: [],
        issueComments: [],
      },
      { filter: "issues" },
    );

    expect(markdown).toBe(
      "## PR Comments\n\n" +
        "### Discussion Comments (0)\n\n" +
        "_No discussion comments found._\n",
    );
  });
});
