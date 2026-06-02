import {
  resolveRuleScope,
  ruleContentMatcherType,
  type GuardrailRule,
} from "./config.ts";

export type EvaluationPhase = "before" | "after";

export function ruleAppliesToPhase(rule: GuardrailRule, phase: EvaluationPhase): boolean {
  const matcherType = ruleContentMatcherType(rule);
  if (resolveRuleScope(rule) === "changed_lines" && matcherType !== "none") {
    return phase === "after";
  }

  if (phase === "before") {
    return matcherType === "none" || matcherType === "ast_grep";
  }

  return matcherType === "semgrep";
}
