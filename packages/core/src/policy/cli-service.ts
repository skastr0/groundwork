import { promises as fs } from "node:fs";
import path from "node:path";
import { Effect } from "effect";
import { extractFrameworkToolTargets } from "../kernel/tool-targets.ts";
import type {
  FrameworkJsonObject,
  FrameworkPendingToolCall,
  FrameworkSessionLock,
  FrameworkToolTarget,
} from "../kernel/state.ts";
import {
  markSessionSkillsLoaded,
  updateSessionArtifactState,
  type SessionArtifactState,
} from "../session/artifacts.ts";
import {
  DEFAULT_EDIT_FOCUSED_TOOLS,
  extractChangeTargets,
  filterPathsByRuleContent,
  findMatchingRules,
  loadMergedPolicyConfig,
  resolveRuleScope,
  ruleMatchesPath,
  ruleMatchesTool,
  type GuardrailAction,
  type GuardrailChangeTarget,
  type GuardrailPolicyConfig,
  type GuardrailRule,
  type GuardrailSeverity,
} from "./config.ts";
import {
  cloneLineRanges,
  collectPatchPayloads,
  mergeChangeTarget,
} from "./change-targets.ts";
import { ruleAppliesToPhase, type EvaluationPhase } from "./evaluation.ts";

const SERVICE = "groundwork-policy";
const POLICY_PENDING_OVERRIDE_LOCK_KEY = "policy-pending-override";
const POLICY_TERMINATION_LOCK_KEY = "policy-terminated";
const POLICY_COMPLETED_INJECT_ONLY_KEY = "policyCompletedInjectOnlyRules";
const MUTATING_TOOLS = new Set<string>(DEFAULT_EDIT_FOCUSED_TOOLS);
const SEVERITY_ORDER: Record<GuardrailSeverity, number> = {
  advisory: 0,
  warn: 1,
  block: 2,
  terminate: 3,
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

type PolicyDecision = "allow" | "warn" | "block";

export interface PolicyEvaluateToolCallInput {
  root_dir?: string;
  directory?: string;
  session_id: string;
  tool: string;
  call_id?: string;
  args?: Record<string, unknown>;
  targets?: Record<string, unknown>[];
}

export interface PolicyEvaluateToolResultInput {
  root_dir?: string;
  session_id: string;
  call_id: string;
  tool?: string;
}

export interface PolicyOverrideInput {
  root_dir?: string;
  session_id: string;
  reason: string;
  rule_id?: string;
  metadata?: Record<string, unknown>;
}

export interface PolicySkillLoadedInput {
  root_dir?: string;
  session_id: string;
  skills: string[];
}

interface PolicyMessage {
  level: "info" | "warn" | "error";
  rule_id?: string;
  action_type?: GuardrailAction["type"];
  text: string;
  paths?: string[];
}

interface PolicyViolation extends PolicyMessage {
  severity: GuardrailSeverity;
  blocking: boolean;
}

interface PolicyEvaluationContext {
  rootDir: string;
  phase: EvaluationPhase;
  config: GuardrailPolicyConfig;
  sessionID: string;
  tool: string;
  callID: string;
  targets: GuardrailChangeTarget[];
  state: SessionArtifactState;
  messages: PolicyMessage[];
  violations: PolicyViolation[];
}

type PolicyActionExecution = {
  action: GuardrailAction;
  actionIndex: number;
  rule: GuardrailRule;
  severity: GuardrailSeverity;
  paths: string[];
};

export async function evaluatePolicyToolCall(input: PolicyEvaluateToolCallInput) {
  const rootDir = resolveRootDir(input.root_dir);
  const { config, projectPath, globalPath, projectPaths, globalPaths, sourceCount } =
    await loadMergedPolicyConfig(rootDir);
  if (!config) {
    return policyIdleResult("policy evaluate-tool-call", input.session_id, {
      rootDir,
      projectPath,
      globalPath,
      projectPaths,
      globalPaths,
      sourceCount,
    });
  }

  const callID = input.call_id ?? `call-${Date.now()}`;
  return updateSessionArtifactState(input.root_dir, input.session_id, async (state) => {
    const guard = enforceSessionGuards(state, input.tool);
    if (guard) {
      return {
        command: "policy evaluate-tool-call",
        decision: "block" as const,
        session_id: input.session_id,
        call_id: callID,
        config_sources: sourceCount,
        messages: [guard],
        violations: [],
      };
    }

    const extraction = extractFrameworkToolTargets(input.args, {
      toolName: input.tool,
      directory: path.resolve(input.directory ?? rootDir),
      rootDir,
    });
    const frameworkTargets =
      input.targets && input.targets.length > 0
        ? input.targets.map(normalizeInputTarget)
        : extraction.targets;
    const targets = materializeGuardrailTargets(rootDir, frameworkTargets, input.args);
    const context = createContext({
      rootDir,
      phase: "before",
      config,
      sessionID: input.session_id,
      tool: input.tool,
      callID,
      targets,
      state,
    });

    await evaluatePolicyRules(context);
    const result = toEvaluationResult("policy evaluate-tool-call", context, {
      config_sources: sourceCount,
      ignored_targets: extraction.ignoredTargets,
    });

    if (result.decision !== "block" && MUTATING_TOOLS.has(input.tool) && frameworkTargets.length > 0) {
      state.session.pendingTools.calls[createPendingToolKey(callID)] = {
        callID,
        toolName: input.tool,
        phase: "after",
        capturedAt: new Date().toISOString(),
        args: toJsonObject(input.args),
        targets: await snapshotTargets(rootDir, frameworkTargets),
        data: { source: SERVICE },
      };
    }

    return result;
  }).then(({ result }) => result);
}

export async function evaluatePolicyToolResult(input: PolicyEvaluateToolResultInput) {
  const rootDir = resolveRootDir(input.root_dir);
  const { config, projectPath, globalPath, projectPaths, globalPaths, sourceCount } =
    await loadMergedPolicyConfig(rootDir);
  if (!config) {
    return policyIdleResult("policy evaluate-tool-result", input.session_id, {
      rootDir,
      projectPath,
      globalPath,
      projectPaths,
      globalPaths,
      sourceCount,
    });
  }

  return updateSessionArtifactState(input.root_dir, input.session_id, async (state) => {
    const pendingKey = createPendingToolKey(input.call_id);
    const pending = state.session.pendingTools.calls[pendingKey];
    if (!pending) {
      return {
        command: "policy evaluate-tool-result",
        decision: "allow" as const,
        session_id: input.session_id,
        call_id: input.call_id,
        config_sources: sourceCount,
        messages: [
          {
            level: "info" as const,
            text: `[groundwork:policy] No pending tool snapshot for call '${input.call_id}'.`,
          },
        ],
        violations: [],
      };
    }

    delete state.session.pendingTools.calls[pendingKey];
    const context = createContext({
      rootDir,
      phase: "after",
      config,
      sessionID: input.session_id,
      tool: pending.toolName,
      callID: input.call_id,
      targets: materializeGuardrailTargets(rootDir, pending.targets),
      state,
    });

    await evaluatePolicyRules(context);
    return toEvaluationResult("policy evaluate-tool-result", context, {
      config_sources: sourceCount,
    });
  }).then(({ result }) => result);
}

export async function acceptPolicyOverride(input: PolicyOverrideInput) {
  const updated = await updateSessionArtifactState(input.root_dir, input.session_id, (state) => {
    const now = new Date().toISOString();
    const clearedPendingLock = state.session.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY] !== undefined;
    state.policy.overrides.push({
      id: `override-${now}`,
      reason: input.reason,
      ruleId: input.rule_id,
      createdAt: now,
      metadata: toJsonObject(input.metadata),
    });
    delete state.session.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY];
    return { clearedPendingLock };
  });
  return {
    command: "policy override",
    decision: "allow" as const,
    session_id: input.session_id,
    accepted: true,
    semantics: {
      kind: "one_shot_pending_lock_clear",
      cleared_pending_lock: updated.result.clearedPendingLock,
      durable_approval: false,
      ttl: null,
      scope: "pending_override_lock",
    },
    state: updated.state,
  };
}

export function confirmPolicySkillsLoadedEffect(input: PolicySkillLoadedInput) {
  return Effect.tryPromise({
    try: () => markSessionSkillsLoaded(input),
    catch: toError,
  }).pipe(
    Effect.map((result) => ({
      command: "policy skill-loaded",
      decision: "allow" as const,
      session_id: input.session_id,
      skills: result.state.policy.confirmedSkills,
      state: result.state,
      artifact_root: result.artifact_root,
    })),
  );
}

function createContext(params: {
  rootDir: string;
  phase: EvaluationPhase;
  config: GuardrailPolicyConfig;
  sessionID: string;
  tool: string;
  callID: string;
  targets: GuardrailChangeTarget[];
  state: SessionArtifactState;
}): PolicyEvaluationContext {
  return {
    ...params,
    messages: [],
    violations: [],
  };
}

async function evaluatePolicyRules(context: PolicyEvaluationContext): Promise<void> {
  if (context.targets.length === 0) return;

  const normalizedPaths = context.targets.map((target) => target.normalizedPath);
  const completed = getCompletedInjectOnlyRules(context.state);
  const rules = findMatchingRules(context.config, normalizedPaths).filter(
    (rule) => ruleAppliesToPhase(rule, context.phase) && ruleMatchesTool(rule, context.tool),
  );

  for (const rule of rules) {
    if (completed.has(rule.id)) continue;

    const pathMatched = context.targets.filter((target) =>
      ruleMatchesPath(rule, target.normalizedPath),
    );
    if (pathMatched.length === 0) continue;

    const filtered = await filterPathsForRule(context.rootDir, rule, pathMatched);
    if (filtered.length === 0) continue;

    const severity = resolveRuleSeverity(rule);
    const hasEnforcementAction = rule.actions.some((action) => !isInjectOnlyAction(action));

    for (let actionIndex = 0; actionIndex < rule.actions.length; actionIndex += 1) {
      const action = rule.actions[actionIndex];
      if (!action) continue;
      await executePolicyAction(context, {
        action,
        actionIndex,
        rule,
        severity,
        paths: filtered,
      });
    }

    if (!hasEnforcementAction) {
      completed.add(rule.id);
      setCompletedInjectOnlyRules(context.state, completed);
    }
  }
}

async function executePolicyAction(
  context: PolicyEvaluationContext,
  params: PolicyActionExecution,
): Promise<void> {
  const { action } = params;
  if (action.type === "inject_prompt") {
    handleInjectPromptAction(context, { ...params, action });
    return;
  }

  if (action.type === "ensure_skill_loaded") {
    await handleEnsureSkillLoadedAction(context, { ...params, action });
    return;
  }

  if (action.type === "block_tool") {
    await handleBlockToolAction(context, { ...params, action });
    return;
  }

  if (action.type === "require_human_override") {
    await handleRequireHumanOverrideAction(context, { ...params, action });
    return;
  }

  if (action.type === "stop_session") {
    await handleStopSessionAction(context, { ...params, action });
  }
}

function handleInjectPromptAction(
  context: PolicyEvaluationContext,
  params: PolicyActionExecution & { action: Extract<GuardrailAction, { type: "inject_prompt" }> },
): void {
  const { action, actionIndex, rule, paths } = params;
  const key = `policy:${rule.id}:${actionIndex}:inject:${action.text}`;
  if (rememberAction(context.state, key, "inject_prompt")) return;
  context.messages.push({
    level: "info",
    rule_id: rule.id,
    action_type: action.type,
    text: `[groundwork:policy] ${action.text}`,
    paths,
  });
}

async function handleEnsureSkillLoadedAction(
  context: PolicyEvaluationContext,
  params: PolicyActionExecution & {
    action: Extract<GuardrailAction, { type: "ensure_skill_loaded" }>;
  },
): Promise<void> {
  const { action, actionIndex, rule, severity, paths } = params;
  const confirmed = new Set(context.state.policy.confirmedSkills.map(normalizeSkillName));
  const missing = action.skills.filter((skill) => !confirmed.has(normalizeSkillName(skill)));
  if (missing.length === 0) return;

  const message =
    action.message ??
    `[groundwork:policy] Required skills missing for rule '${rule.id}': ${missing.join(", ")}. Confirm with 'groundwork policy skill-loaded'.`;
  const guidanceKey = `policy:${rule.id}:${actionIndex}:skills:${missing
    .map(normalizeSkillName)
    .sort()
    .join(",")}`;
  if (!rememberAction(context.state, guidanceKey, "ensure_skill_loaded_guidance")) {
    context.messages.push({
      level: "info",
      rule_id: rule.id,
      action_type: action.type,
      text: `${message} Load the required skills before continuing.`,
      paths,
    });
  }

  if ((action.mode ?? "prompt") !== "prompt") {
    await recordViolation(context, rule, action.type, severity, message, paths);
  }
}

async function handleBlockToolAction(
  context: PolicyEvaluationContext,
  params: PolicyActionExecution & { action: Extract<GuardrailAction, { type: "block_tool" }> },
): Promise<void> {
  const { action, rule, severity, paths } = params;
  await recordViolation(
    context,
    rule,
    action.type,
    severity,
    action.message ??
      `[groundwork:policy] Tool execution blocked by policy rule '${rule.id}' for paths: ${paths.join(", ")}`,
    paths,
  );
}

async function handleRequireHumanOverrideAction(
  context: PolicyEvaluationContext,
  params: PolicyActionExecution & {
    action: Extract<GuardrailAction, { type: "require_human_override" }>;
  },
): Promise<void> {
  const { action, rule, severity, paths } = params;
  if (isBlockingSeverity(severity)) {
    setLock(context.state, POLICY_PENDING_OVERRIDE_LOCK_KEY, {
      scope: "mutating-tools",
      reason:
        action.message ??
        `Rule '${rule.id}' requires explicit human override. Use 'groundwork policy override' to unlock mutating tools.`,
      source: SERVICE,
      createdAt: new Date().toISOString(),
      paths: [...paths],
      metadata: { ruleId: rule.id },
    });
  }
  await recordViolation(
    context,
    rule,
    action.type,
    severity,
    action.message ??
      `[groundwork:policy] Rule '${rule.id}' requires explicit human override. Use 'groundwork policy override' to continue.`,
    paths,
  );
}

async function handleStopSessionAction(
  context: PolicyEvaluationContext,
  params: PolicyActionExecution & { action: Extract<GuardrailAction, { type: "stop_session" }> },
): Promise<void> {
  const { action, rule, paths } = params;
  const message =
    action.message ??
    `[groundwork:policy] Session terminated due to critical policy violation in rule '${rule.id}'.`;
  setLock(context.state, POLICY_TERMINATION_LOCK_KEY, {
    scope: "session",
    reason: message,
    source: SERVICE,
    createdAt: new Date().toISOString(),
    paths: [...paths],
    metadata: { ruleId: rule.id },
  });
  await recordViolation(context, rule, action.type, "terminate", message, paths);
}

async function recordViolation(
  context: PolicyEvaluationContext,
  rule: GuardrailRule,
  actionType: GuardrailAction["type"],
  severity: GuardrailSeverity,
  message: string,
  paths: string[],
): Promise<void> {
  const blocking = isBlockingSeverity(severity);
  const violation = {
    level: severityToLogLevel(severity),
    rule_id: rule.id,
    action_type: actionType,
    text: message,
    paths,
    severity,
    blocking,
  } satisfies PolicyViolation;
  context.messages.push(violation);
  context.violations.push(violation);
}

function enforceSessionGuards(state: SessionArtifactState, tool: string): PolicyMessage | null {
  const termination = state.session.locks.active[POLICY_TERMINATION_LOCK_KEY];
  if (termination) {
    return {
      level: "error",
      rule_id: readRuleId(termination),
      text: `[groundwork:policy] Session is terminated by rule '${readRuleId(termination)}'. Start a new session to continue.`,
      paths: termination.paths,
    };
  }

  const pending = state.session.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY];
  if (pending && MUTATING_TOOLS.has(tool)) {
    return {
      level: "error",
      rule_id: readRuleId(pending),
      text: `[groundwork:policy] Mutating tools are locked by rule '${readRuleId(pending)}'. Provide human override with 'groundwork policy override' to continue.`,
      paths: pending.paths,
    };
  }

  return null;
}

function toEvaluationResult(
  command: string,
  context: PolicyEvaluationContext,
  extra: Record<string, unknown>,
) {
  const decision: PolicyDecision = context.violations.some((violation) => violation.blocking)
    ? "block"
    : context.violations.length > 0
      ? "warn"
      : "allow";
  return {
    command,
    decision,
    phase: context.phase,
    session_id: context.sessionID,
    call_id: context.callID,
    tool: context.tool,
    messages: context.messages,
    violations: context.violations,
    ...extra,
  };
}

async function filterPathsForRule(
  rootDir: string,
  rule: GuardrailRule,
  targets: GuardrailChangeTarget[],
): Promise<string[]> {
  if (!rule.content || rule.content.length === 0) {
    return targets.map((target) => target.normalizedPath);
  }

  if (resolveRuleScope(rule) === "changed_lines") {
    return filterPathsByRuleContent({ rootDir, targets, rule });
  }

  return filterPathsByRuleContent({ rootDir, targets, rule });
}

function materializeGuardrailTargets(
  rootDir: string,
  targets: readonly FrameworkToolTarget[],
  args?: unknown,
): GuardrailChangeTarget[] {
  const merged = new Map<string, GuardrailChangeTarget>();
  for (const target of targets) {
    const normalizedPath = target.normalizedPath ?? target.afterPath ?? target.beforePath;
    if (!normalizedPath) continue;
    mergeChangeTarget(merged, {
      normalizedPath,
      beforeContent:
        typeof target.metadata?.beforeContent === "string" || target.metadata?.beforeContent === null
          ? target.metadata.beforeContent
          : undefined,
      changedLineRanges: cloneLineRanges(target.changedLineRanges),
      deletedLineRanges: cloneLineRanges(target.deletedLineRanges),
    });
  }

  for (const patchText of collectPatchPayloads(args)) {
    for (const patchTarget of extractChangeTargets(rootDir, { patchText })) {
      if (merged.has(patchTarget.normalizedPath)) {
        mergeChangeTarget(merged, patchTarget);
      }
    }
  }

  return [...merged.values()];
}

async function snapshotTargets(
  rootDir: string,
  targets: readonly FrameworkToolTarget[],
): Promise<FrameworkPendingToolCall["targets"]> {
  return Promise.all(
    targets.map(async (target) => {
      const beforePath = target.beforePath ?? target.normalizedPath ?? target.afterPath;
      const metadata = toJsonObject(target.metadata) ?? {};
      if (beforePath) {
        metadata.beforeContent = await fs
          .readFile(path.resolve(rootDir, beforePath), "utf8")
          .catch(() => null);
      } else {
        metadata.beforeContent = null;
      }
      return {
        ...target,
        changedLineRanges: cloneLineRanges(target.changedLineRanges),
        deletedLineRanges: cloneLineRanges(target.deletedLineRanges),
        metadata,
      };
    }),
  );
}

function getCompletedInjectOnlyRules(state: SessionArtifactState): Set<string> {
  const value = state.session.metadata?.[POLICY_COMPLETED_INJECT_ONLY_KEY];
  return new Set(Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);
}

function setCompletedInjectOnlyRules(state: SessionArtifactState, rules: Set<string>): void {
  state.session.metadata = state.session.metadata ?? {};
  state.session.metadata[POLICY_COMPLETED_INJECT_ONLY_KEY] = [...rules].sort();
}

function rememberAction(state: SessionArtifactState, key: string, action: string): boolean {
  const now = new Date().toISOString();
  const existing = state.actions[key];
  state.actions[key] = {
    source: SERVICE,
    action,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    count: (existing?.count ?? 0) + 1,
  };
  return existing !== undefined;
}

function setLock(state: SessionArtifactState, key: string, lock: FrameworkSessionLock): void {
  state.session.locks.active[key] = lock;
}

function resolveRuleSeverity(rule: GuardrailRule): GuardrailSeverity {
  if (rule.severity) return rule.severity;
  if (rule.actions.some((action) => action.type === "stop_session")) return "terminate";
  if (rule.actions.some((action) => !isInjectOnlyAction(action))) return "block";
  return "advisory";
}

function isInjectOnlyAction(action: GuardrailAction): boolean {
  return (
    action.type === "inject_prompt" ||
    (action.type === "ensure_skill_loaded" && (action.mode ?? "prompt") === "prompt")
  );
}

function isBlockingSeverity(severity: GuardrailSeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER.block;
}

function severityToLogLevel(severity: GuardrailSeverity): "info" | "warn" | "error" {
  if (severity === "advisory") return "info";
  if (severity === "warn") return "warn";
  return "error";
}

function toJsonObject(value: unknown): FrameworkJsonObject | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as FrameworkJsonObject;
}

function createPendingToolKey(callID: string): string {
  return `${SERVICE}::${callID}`;
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase();
}

function readRuleId(lock: FrameworkSessionLock): string {
  const ruleId = lock.metadata?.ruleId;
  return typeof ruleId === "string" ? ruleId : lock.source;
}

function normalizeInputTarget(target: Record<string, unknown>): FrameworkToolTarget {
  const pathValue =
    typeof target.path === "string"
      ? target.path
      : typeof target.normalizedPath === "string"
        ? target.normalizedPath
        : "";
  return {
    path: pathValue,
    normalizedPath: typeof target.normalizedPath === "string" ? target.normalizedPath : pathValue,
    beforePath: typeof target.beforePath === "string" ? target.beforePath : undefined,
    afterPath: typeof target.afterPath === "string" ? target.afterPath : undefined,
    changedLineRanges: Array.isArray(target.changedLineRanges)
      ? target.changedLineRanges.filter(isLineRange)
      : undefined,
    deletedLineRanges: Array.isArray(target.deletedLineRanges)
      ? target.deletedLineRanges.filter(isLineRange)
      : undefined,
    metadata: toJsonObject(target.metadata),
  };
}

function isLineRange(value: unknown): value is { startLine: number; endLine: number } {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { startLine?: unknown }).startLine === "number" &&
    typeof (value as { endLine?: unknown }).endLine === "number"
  );
}

function resolveRootDir(rootDir: string | undefined): string {
  return path.resolve(rootDir ?? process.cwd());
}

function policyIdleResult(
  command: string,
  sessionID: string,
  extra: Record<string, unknown>,
) {
  return {
    command,
    decision: "allow" as const,
    session_id: sessionID,
    active: false,
    messages: [],
    violations: [],
    ...extra,
  };
}
