import { logFrameworkEvent } from "../logger/index.ts";
import {
  findMatchingRules,
  ruleMatchesPath,
  ruleMatchesTool,
  type GuardrailChangeTarget,
  type GuardrailPolicyConfig,
  type GuardrailRule,
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

interface EvaluateRulesForPhaseParams {
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
}

interface RuleEvaluationContext {
  phase: EvaluationPhase;
  rootDir: string;
  tool: string;
  callID: string;
  sessionID: string;
  targets: GuardrailChangeTarget[];
  client: FrameworkPolicyRuntimeClient;
  sessionStore: SessionKernelStore;
  state: FrameworkSessionKernelState;
  runtimeState: PolicyRuntimeState;
}

interface RuleExecutionContext extends RuleEvaluationContext {
  rule: GuardrailRule;
  ruleSeverity: ReturnType<typeof resolveRuleSeverity>;
  normalizedPaths: string[];
}

export async function evaluateRulesForPhase(
  params: EvaluateRulesForPhaseParams,
): Promise<FrameworkSessionKernelState> {
  const { phase, config, tool, targets } = params;
  const state = params.state;
  const normalizedPaths = targets.map((target) => target.normalizedPath);
  const rules = findRulesForPhase(config, normalizedPaths, phase, tool);

  if (rules.length === 0) {
    return state;
  }

  const context = createRuleEvaluationContext(params);
  for (const rule of rules) {
    await evaluateRuleForPhase(rule, context);
  }

  return state;
}

function findRulesForPhase(
  config: GuardrailPolicyConfig,
  normalizedPaths: string[],
  phase: EvaluationPhase,
  tool: string,
): GuardrailRule[] {
  return findMatchingRules(config, normalizedPaths).filter(
    (rule) => ruleAppliesToPhase(rule, phase) && ruleMatchesTool(rule, tool),
  );
}

function createRuleEvaluationContext(
  params: EvaluateRulesForPhaseParams,
): RuleEvaluationContext {
  const { phase, rootDir, tool, callID, sessionID, targets, client, sessionStore, runtimeState } =
    params;
  return {
    phase,
    rootDir,
    tool,
    callID,
    sessionID,
    targets,
    client,
    sessionStore,
    state: params.state,
    runtimeState,
  };
}

async function evaluateRuleForPhase(
  rule: GuardrailRule,
  context: RuleEvaluationContext,
): Promise<void> {
  if (context.runtimeState.completedInjectOnlyRules.has(rule.id)) {
    return;
  }

  const normalizedPaths = await getFilteredRulePaths(rule, context);
  if (normalizedPaths.length === 0) {
    return;
  }

  const ruleSeverity = resolveRuleSeverity(rule);
  await logMatchedRule({ ...context, rule, ruleSeverity, normalizedPaths });
  await executeRuleActions({ ...context, rule, ruleSeverity, normalizedPaths });
  recordInjectOnlyCompletion(rule, context.runtimeState);
}

async function getFilteredRulePaths(
  rule: GuardrailRule,
  context: RuleEvaluationContext,
): Promise<string[]> {
  const pathMatched = context.targets.filter((target) =>
    ruleMatchesPath(rule, target.normalizedPath),
  );
  if (pathMatched.length === 0) {
    return [];
  }

  return filterPathsForRule({
    rootDir: context.rootDir,
    rule,
    targets: pathMatched,
    state: context.state,
  });
}

async function logMatchedRule(context: RuleExecutionContext): Promise<void> {
  await logFrameworkEvent(context.client, SERVICE, "debug", "Policy rule matched", {
    phase: context.phase,
    tool: context.tool,
    callID: context.callID,
    sessionID: context.sessionID,
    rule_id: context.rule.id,
    severity: context.ruleSeverity,
    paths: context.normalizedPaths,
  });
}

async function executeRuleActions(context: RuleExecutionContext): Promise<void> {
  for (let actionIndex = 0; actionIndex < context.rule.actions.length; actionIndex += 1) {
    const action = context.rule.actions[actionIndex];
    if (!action) continue;

    await executeAction({
      action,
      actionIndex,
      phase: context.phase,
      tool: context.tool,
      callID: context.callID,
      sessionID: context.sessionID,
      rule: context.rule,
      ruleSeverity: context.ruleSeverity,
      normalizedPaths: context.normalizedPaths,
      rootDir: context.rootDir,
      client: context.client,
      sessionStore: context.sessionStore,
      state: context.state,
      runtimeState: context.runtimeState,
    });
  }
}

function recordInjectOnlyCompletion(
  rule: GuardrailRule,
  runtimeState: PolicyRuntimeState,
): void {
  if (rule.actions.every(isInjectOnlyAction)) {
    runtimeState.completedInjectOnlyRules.add(rule.id);
  }
}
