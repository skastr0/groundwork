import { logFrameworkEvent } from "../logger/index.ts";
import {
  findMatchingRules,
  ruleMatchesPath,
  ruleMatchesTool,
  type GuardrailChangeTarget,
  type GuardrailPolicyConfig,
} from "./config.ts";
import { ruleAppliesToPhase, type EvaluationPhase } from "./evaluation.ts";
import {
  executeAction,
  isInjectOnlyAction,
  resolveRuleSeverity,
} from "./runtime-actions.ts";
import { filterPathsForRule } from "./runtime-filtering.ts";
import {
  SERVICE,
  type FrameworkPolicyRuntimeClient,
  type PolicyRuntimeState,
} from "./runtime-types.ts";
import type {
  FrameworkSessionKernelState,
  SessionKernelStore,
} from "../kernel/index.ts";

export async function evaluateRulesForPhase(params: {
  phase: EvaluationPhase;
  config: GuardrailPolicyConfig;
  rootDir: string;
  tool: string;
  callID: string;
  sessionID: string;
  targets: GuardrailChangeTarget[];
  client: FrameworkPolicyRuntimeClient;
  sessionStore: SessionKernelStore;
  state: FrameworkSessionKernelState;
  runtimeState: PolicyRuntimeState;
}): Promise<FrameworkSessionKernelState> {
  const { phase, config, rootDir, tool, callID, sessionID, targets, client, runtimeState } = params;
  const state = params.state;
  const normalizedPaths = targets.map((target) => target.normalizedPath);

  const rules = findMatchingRules(config, normalizedPaths).filter(
    (rule) => ruleAppliesToPhase(rule, phase) && ruleMatchesTool(rule, tool),
  );
  if (rules.length === 0) {
    return state;
  }

  for (const rule of rules) {
    if (runtimeState.completedInjectOnlyRules.has(rule.id)) {
      continue;
    }

    const pathMatched = targets.filter((target) => ruleMatchesPath(rule, target.normalizedPath));
    if (pathMatched.length === 0) {
      continue;
    }

    const filtered = await filterPathsForRule({
      rootDir,
      rule,
      targets: pathMatched,
      state,
    });
    if (filtered.length === 0) {
      continue;
    }

    const ruleSeverity = resolveRuleSeverity(rule);

    await logFrameworkEvent(client, SERVICE, "debug", "Policy rule matched", {
      phase,
      tool,
      callID,
      sessionID,
      rule_id: rule.id,
      severity: ruleSeverity,
      paths: filtered,
    });

    const hasEnforcementAction = rule.actions.some((action) => !isInjectOnlyAction(action));
    for (let actionIndex = 0; actionIndex < rule.actions.length; actionIndex += 1) {
      const action = rule.actions[actionIndex];
      if (!action) continue;

      await executeAction({
        action,
        actionIndex,
        phase,
        tool,
        callID,
        sessionID,
        rule,
        ruleSeverity,
        normalizedPaths: filtered,
        rootDir,
        client,
        sessionStore: params.sessionStore,
        state,
        runtimeState,
      });
    }

    if (!hasEnforcementAction) {
      runtimeState.completedInjectOnlyRules.add(rule.id);
    }
  }

  return state;
}
