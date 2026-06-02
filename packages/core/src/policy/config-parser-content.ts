import type {
  AstGrepContentMatcher,
  GuardrailContentMatcher,
  SemgrepContentMatcher,
} from "./config-types.ts";
import {
  normalizeStringList,
  parseMatcherExpectation,
  parseOptionalMatcherTextField,
  parsePositiveNumber,
  parseSemgrepSeverity,
  parseStrictness,
} from "./config-parser-fields.ts";

export function parseContentMatcher(
  ruleId: string,
  value: unknown,
  index: number,
): GuardrailContentMatcher {
  if (!value || typeof value !== "object") {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' must be an object`);
  }

  const raw = value as Record<string, unknown>;
  const matcherType = normalizeMatcherType(raw.type);
  if (matcherType === "ast_grep") {
    return parseAstGrepContentMatcher(ruleId, index, raw);
  }

  return parseSemgrepContentMatcher(ruleId, index, raw);
}

function normalizeMatcherType(rawType: unknown): "ast_grep" | "semgrep" {
  if (rawType === undefined) return "ast_grep";
  if (typeof rawType !== "string") {
    throw new Error("Content matcher type must be a string");
  }

  const normalized = rawType.trim().toLowerCase();
  if (["ast_grep", "ast-grep", "astgrep"].includes(normalized)) {
    return "ast_grep";
  }

  if (["semgrep", "sem-grep"].includes(normalized)) {
    return "semgrep";
  }

  throw new Error(`Unsupported content matcher type '${rawType}'`);
}

function parseAstGrepContentMatcher(
  ruleId: string,
  index: number,
  raw: Record<string, unknown>,
): AstGrepContentMatcher {
  if (typeof raw.pattern !== "string" || raw.pattern.trim().length === 0) {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' requires non-empty pattern`);
  }

  const strictness = parseStrictness(ruleId, index, raw.strictness);
  return {
    type: "ast_grep",
    pattern: raw.pattern,
    selector: parseOptionalMatcherTextField(ruleId, index, raw.selector, "selector"),
    language: typeof raw.language === "string" ? raw.language : undefined,
    strictness,
    expect: parseMatcherExpectation(ruleId, index, raw.expect),
  };
}

function parseSemgrepContentMatcher(
  ruleId: string,
  index: number,
  raw: Record<string, unknown>,
): SemgrepContentMatcher {
  const rawConfigs = raw.configs ?? raw.config;
  const configs = normalizeStringList(rawConfigs);
  if (configs.length === 0) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' requires non-empty configs for semgrep`,
    );
  }

  const severity = parseSemgrepSeverity(ruleId, index, raw.severity);

  return {
    type: "semgrep",
    configs,
    severity,
    include_rule_ids: normalizeStringList(raw.include_rule_ids ?? raw.include_rules),
    exclude_rule_ids: normalizeStringList(raw.exclude_rule_ids ?? raw.exclude_rules),
    timeout_s: parsePositiveNumber(ruleId, index, raw.timeout_s, "timeout_s"),
    expect: parseMatcherExpectation(ruleId, index, raw.expect),
  };
}
