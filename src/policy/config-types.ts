export type GuardrailSeverity = "advisory" | "warn" | "block" | "terminate";
export type GuardrailMatcherExpectation = "present" | "absent";
export type GuardrailSkillEnforcementMode = "prompt" | "block";
export type GuardrailContentScope = "changed_lines" | "full_file";

export type GuardrailAction =
  | {
      type: "inject_prompt";
      text: string;
      once_per_session?: boolean;
    }
  | {
      type: "block_tool";
      message?: string;
    }
  | {
      type: "require_human_override";
      message?: string;
    }
  | {
      type: "stop_session";
      message?: string;
    }
  | {
      type: "ensure_skill_loaded";
      skills: string[];
      mode?: GuardrailSkillEnforcementMode;
      message?: string;
      once_per_session?: boolean;
    };

export type AstGrepStrictness = "cst" | "smart" | "ast" | "relaxed" | "signature" | "template";

export type SemgrepSeverity = "INFO" | "WARNING" | "ERROR";

export type AstGrepContentMatcher = {
  type: "ast_grep";
  pattern: string;
  selector?: string;
  language?: string;
  strictness?: AstGrepStrictness;
  expect?: GuardrailMatcherExpectation;
};

export type SemgrepContentMatcher = {
  type: "semgrep";
  configs: string[];
  severity?: SemgrepSeverity[];
  include_rule_ids?: string[];
  exclude_rule_ids?: string[];
  timeout_s?: number;
  expect?: GuardrailMatcherExpectation;
};

export type GuardrailContentMatcher = AstGrepContentMatcher | SemgrepContentMatcher;

export type GuardrailRule = {
  id: string;
  description?: string;
  severity?: GuardrailSeverity;
  match: string[];
  tools_include?: string[];
  tools_exclude?: string[];
  content?: GuardrailContentMatcher[];
  content_mode?: "any" | "all";
  scope?: GuardrailContentScope;
  actions: GuardrailAction[];
};

export type GuardrailPolicyConfig = {
  version: 1;
  plugins?: string[];
  includes?: string[];
  rules: GuardrailRule[];
};

export type ContentMatchRunner = (params: {
  rootDir: string;
  filePath: string;
  matcher: GuardrailContentMatcher;
}) => Promise<boolean>;

export type LineRange = {
  startLine: number;
  endLine: number;
};

export type GuardrailChangeTarget = {
  normalizedPath: string;
  changedLineRanges?: LineRange[];
  deletedLineRanges?: LineRange[];
  beforeContent?: string | null;
};

export const DEFAULT_EDIT_FOCUSED_TOOLS = [
  "edit",
  "write",
  "patch",
  "apply_patch",
  "edit_file",
  "morph-mcp_edit_file",
] as const;
