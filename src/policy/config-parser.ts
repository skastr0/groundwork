import type {
  GuardrailContentMatcher,
  GuardrailPolicyConfig,
  GuardrailRule,
} from "./config-types.ts";
import { parseAction } from "./config-parser-actions.ts";
import { parseContentMatcher } from "./config-parser-content.ts";
import {
  assertSingleContentMatcherType,
  assertUniqueRuleIds,
  parseContentMode,
  parseContentScope,
  parseIncludes,
  parseRuleSeverity,
  parseToolPatterns,
} from "./config-parser-fields.ts";

export function parsePolicyConfig(value: unknown): GuardrailPolicyConfig {
  if (!value || typeof value !== "object") {
    throw new Error("Policy config must be an object");
  }

  const raw = value as {
    version?: unknown;
    plugins?: unknown;
    plugin?: unknown;
    include?: unknown;
    includes?: unknown;
    rules?: unknown;
  };
  if (raw.version !== 1) {
    throw new Error("Policy config version must be 1");
  }

  const plugins = parseIncludes(raw.plugins ?? raw.plugin);
  const includes = parseIncludes(raw.includes ?? raw.include);
  if (raw.rules !== undefined && !Array.isArray(raw.rules)) {
    throw new Error("Policy config rules must be an array");
  }
  if (raw.rules === undefined && plugins.length === 0 && includes.length === 0) {
    throw new Error("Policy config rules must be an array");
  }

  const rawRules = raw.rules ?? [];
  const rules = rawRules.map((rule, index) => parseRule(rule, index));
  assertUniqueRuleIds(rules, "policy config");
  return { version: 1, plugins, includes, rules };
}

function parseRule(value: unknown, index: number): GuardrailRule {
  if (!value || typeof value !== "object") {
    throw new Error(`Rule at index ${index} must be an object`);
  }

  const raw = value as {
    id?: unknown;
    description?: unknown;
    severity?: unknown;
    match?: unknown;
    tools_include?: unknown;
    tools_exclude?: unknown;
    content?: unknown;
    content_mode?: unknown;
    scope?: unknown;
    actions?: unknown;
  };

  if (typeof raw.id !== "string" || raw.id.trim().length === 0) {
    throw new Error(`Rule at index ${index} must define a non-empty id`);
  }
  const id = raw.id;
  const match = parseRuleMatch(id, raw.match);
  const content = parseRuleContent(id, raw.content);
  const contentMode = parseContentMode(id, raw.content_mode);

  if (!Array.isArray(raw.actions) || raw.actions.length === 0) {
    throw new Error(`Rule '${id}' must include at least one action`);
  }
  if (contentMode && content.length === 0) {
    throw new Error(`Rule '${id}' sets content_mode but has no content matchers`);
  }

  return {
    id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    severity: parseRuleSeverity(id, raw.severity),
    match,
    tools_include: parseToolPatterns(raw.tools_include),
    tools_exclude: parseToolPatterns(raw.tools_exclude),
    content: content.length > 0 ? content : undefined,
    content_mode: contentMode,
    scope: parseContentScope(id, raw.scope),
    actions: raw.actions.map((action, actionIndex) => parseAction(id, action, actionIndex)),
  };
}

function parseRuleMatch(ruleId: string, rawMatch: unknown): string[] {
  const patterns = Array.isArray(rawMatch) ? rawMatch : [rawMatch];
  const match = patterns
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (match.length === 0) {
    throw new Error(`Rule '${ruleId}' must include at least one match pattern`);
  }

  return match;
}

function parseRuleContent(ruleId: string, rawContent: unknown): GuardrailContentMatcher[] {
  const rawEntries =
    rawContent === undefined ? [] : Array.isArray(rawContent) ? rawContent : [rawContent];
  const content = rawEntries.map((entry, contentIndex) =>
    parseContentMatcher(ruleId, entry, contentIndex),
  );
  assertSingleContentMatcherType(ruleId, content);
  return content;
}
