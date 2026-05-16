import type { FrameworkSessionKernelState } from "../kernel/index.ts";
import {
  filterPathsByRuleContent,
  resolveRuleScope,
  type GuardrailChangeTarget,
  type GuardrailRule,
} from "./config.ts";
import {
  readContentMatchCache,
  writeContentMatchCache,
} from "./runtime-cache.ts";

export async function filterPathsForRule(params: {
  rootDir: string;
  rule: GuardrailRule;
  targets: GuardrailChangeTarget[];
  state: FrameworkSessionKernelState;
}): Promise<string[]> {
  const { rootDir, rule, targets, state } = params;
  if (!rule.content || rule.content.length === 0) {
    return targets.map((target) => target.normalizedPath);
  }

  if (resolveRuleScope(rule) === "changed_lines") {
    return filterPathsByRuleContent({
      rootDir,
      targets,
      rule,
    });
  }

  const cachedMatches: string[] = [];
  const pending: GuardrailChangeTarget[] = [];

  for (const target of targets) {
    const normalizedPath = target.normalizedPath;
    const cached = readContentMatchCache(state, rule.id, normalizedPath);
    if (cached === undefined) {
      pending.push(target);
      continue;
    }

    if (cached) {
      cachedMatches.push(normalizedPath);
    }
  }

  if (pending.length === 0) {
    return cachedMatches;
  }

  const newlyMatched = await filterPathsByRuleContent({
    rootDir,
    targets: pending,
    rule,
  });
  const newlyMatchedSet = new Set(newlyMatched);
  const now = new Date().toISOString();

  for (const target of pending) {
    writeContentMatchCache(
      state,
      now,
      rule.id,
      target.normalizedPath,
      newlyMatchedSet.has(target.normalizedPath),
    );
  }

  return [...cachedMatches, ...newlyMatched];
}
