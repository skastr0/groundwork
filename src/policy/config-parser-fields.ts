import type {
  AstGrepStrictness,
  GuardrailContentMatcher,
  GuardrailContentScope,
  GuardrailMatcherExpectation,
  GuardrailRule,
  GuardrailSeverity,
  SemgrepSeverity,
} from "./config-types.ts";

const AST_GREP_STRICTNESS = new Set<AstGrepStrictness>([
  "cst",
  "smart",
  "ast",
  "relaxed",
  "signature",
  "template",
]);
const SEMGREP_SEVERITY = new Set<SemgrepSeverity>(["INFO", "WARNING", "ERROR"]);
const GUARDRAIL_SEVERITY = new Set<GuardrailSeverity>(["advisory", "warn", "block", "terminate"]);
const MATCHER_EXPECTATION = new Set<GuardrailMatcherExpectation>(["present", "absent"]);
const CONTENT_SCOPE = new Set<GuardrailContentScope>(["changed_lines", "full_file"]);

export function parseIncludes(value: unknown): string[] {
  if (value === undefined) return [];
  const entries = Array.isArray(value) ? value : [value];
  const includes: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new Error("Policy config include paths must be non-empty strings");
    }

    includes.push(entry.trim());
  }

  return includes;
}

export function assertUniqueRuleIds(rules: GuardrailRule[], context: string): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) {
      throw new Error(`Duplicate rule id '${rule.id}' in ${context}`);
    }
    seen.add(rule.id);
  }
}

export function normalizeStringList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function parseOptionalMatcherTextField(
  ruleId: string,
  index: number,
  value: unknown,
  fieldName: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid ${fieldName}`);
  }

  return value.trim();
}

export function parseToolPatterns(value: unknown): string[] | undefined {
  const patterns = normalizeStringList(value);
  return patterns.length > 0 ? patterns : undefined;
}

export function parseSemgrepSeverity(
  ruleId: string,
  index: number,
  value: unknown,
): SemgrepSeverity[] | undefined {
  if (value === undefined) return undefined;
  const rawValues = Array.isArray(value) ? value : [value];
  const severities: SemgrepSeverity[] = [];

  for (const rawSeverity of rawValues) {
    if (typeof rawSeverity !== "string") {
      throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid severity value`);
    }

    const normalized = rawSeverity.trim().toUpperCase() as SemgrepSeverity;
    if (!SEMGREP_SEVERITY.has(normalized)) {
      throw new Error(
        `Content matcher ${index} in rule '${ruleId}' has unsupported severity '${rawSeverity}'`,
      );
    }

    severities.push(normalized);
  }

  return severities.length > 0 ? severities : undefined;
}

export function parsePositiveNumber(
  ruleId: string,
  index: number,
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' has invalid positive number for ${field}`,
    );
  }

  return value;
}

export function parseStrictness(
  ruleId: string,
  index: number,
  value: unknown,
): AstGrepStrictness | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid strictness`);
  }

  const normalized = value.trim().toLowerCase() as AstGrepStrictness;
  if (!AST_GREP_STRICTNESS.has(normalized)) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' has unsupported strictness '${value}'`,
    );
  }

  return normalized;
}

export function parseMatcherExpectation(
  ruleId: string,
  index: number,
  value: unknown,
): GuardrailMatcherExpectation | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Content matcher ${index} in rule '${ruleId}' has invalid expect value`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailMatcherExpectation;
  if (!MATCHER_EXPECTATION.has(normalized)) {
    throw new Error(
      `Content matcher ${index} in rule '${ruleId}' has unsupported expect '${value}'`,
    );
  }

  return normalized;
}

export function parseContentMode(ruleId: string, value: unknown): "any" | "all" | undefined {
  if (value === undefined) return undefined;
  if (value === "any" || value === "all") return value;
  throw new Error(`Rule '${ruleId}' has invalid content_mode '${String(value)}'`);
}

export function parseContentScope(
  ruleId: string,
  value: unknown,
): GuardrailContentScope | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Rule '${ruleId}' has invalid scope value`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailContentScope;
  if (!CONTENT_SCOPE.has(normalized)) {
    throw new Error(`Rule '${ruleId}' has unsupported scope '${value}'`);
  }

  return normalized;
}

export function parseRuleSeverity(ruleId: string, value: unknown): GuardrailSeverity | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Rule '${ruleId}' has invalid severity value`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailSeverity;
  if (!GUARDRAIL_SEVERITY.has(normalized)) {
    throw new Error(`Rule '${ruleId}' has unsupported severity '${value}'`);
  }

  return normalized;
}

export function assertSingleContentMatcherType(
  ruleId: string,
  content: GuardrailContentMatcher[],
): void {
  if (content.length <= 1) return;

  const matcherTypes = new Set(content.map((matcher) => matcher.type));
  if (matcherTypes.size > 1) {
    throw new Error(
      `Rule '${ruleId}' mixes content matcher types; split into separate rules per matcher type`,
    );
  }
}
