import type {
  GuardrailContentMatcher,
  LineRange,
} from "../config.ts";

export type GuardrailMatcherSnippet = {
  source: "after" | "before";
  baseLine: number;
  range: LineRange;
  content: string;
};

export type ChangeDeltaRanges = {
  addedAfterLineRanges: LineRange[];
  deletedBeforeLineRanges: LineRange[];
};

export type ChangedLineSnippetPlan =
  | {
      mode: "snippets";
      snippets: GuardrailMatcherSnippet[];
    }
  | {
      mode: "full_file";
      reason:
        | "empty_after_content"
        | "too_many_windows"
        | "window_too_large"
        | "coverage_too_large";
    };

export type SnippetOnlyPlan = Extract<ChangedLineSnippetPlan, { mode: "snippets" }>;

export type ContentMatchRegionRunner = (params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
  snippet?: GuardrailMatcherSnippet;
}) => Promise<LineRange[]>;

export type MatcherProcessOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};
