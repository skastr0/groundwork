import { type PluginInput } from "@opencode-ai/plugin";

export type Shell = PluginInput["$"];

export type Result<T> = { success: true; data: T } | { success: false; error: string };

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

export interface GraphQLReviewThreadComments {
  nodes: Array<{ databaseId: number | null }>;
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

export interface GraphQLReviewThread {
  id: string;
  isResolved: boolean;
  isCollapsed: boolean;
  outdated: boolean;
  resolvedBy?: { login: string } | null;
  comments: GraphQLReviewThreadComments;
}

export interface GraphQLReviewThreadConnection {
  nodes: GraphQLReviewThread[];
  pageInfo: {
    hasNextPage: boolean;
    endCursor: string | null;
  };
}

export interface GraphQLResponse {
  data: {
    repository: {
      pullRequest: {
        reviewThreads: GraphQLReviewThreadConnection;
      };
    };
  };
}

export interface GraphQLThreadCommentsResponse {
  data: {
    node: {
      comments: GraphQLReviewThreadComments;
    } | null;
  };
}

export interface ThreadCommentsPage {
  ids: number[];
  nextCursor: string | null;
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

export interface ThreadNode {
  comment: GitHubReviewComment;
  children: ThreadNode[];
}
