import {
  DEFAULT_EDIT_FOCUSED_TOOLS,
  type GuardrailPolicyConfig,
  type GuardrailRule,
} from "./config-types.ts";
import { globMatch, toolMatchesPatterns } from "./glob.ts";

export function findMatchingRules(
  config: GuardrailPolicyConfig,
  normalizedPaths: string[],
): GuardrailRule[] {
  if (normalizedPaths.length === 0) return [];

  return config.rules.filter((rule) =>
    normalizedPaths.some((target) => ruleMatchesPath(rule, target)),
  );
}

export function ruleMatchesPath(rule: GuardrailRule, normalizedPath: string): boolean {
  return rule.match.some((pattern) => globMatch(pattern, normalizedPath));
}

export function ruleMatchesTool(rule: GuardrailRule, tool: string): boolean {
  const include = rule.tools_include ?? [...DEFAULT_EDIT_FOCUSED_TOOLS];
  if (!toolMatchesPatterns(include, tool)) {
    return false;
  }

  const exclude = rule.tools_exclude ?? [];
  return !toolMatchesPatterns(exclude, tool);
}
