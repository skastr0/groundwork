import { promises as fs } from "node:fs";
import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import {
  FrameworkEnforcementError,
  type GroundworkLayerRegistration,
} from "../layer/index.ts";
import {
  clearFrameworkCacheEntry,
  createSessionKernelStore,
  extractFrameworkToolTargets,
  getFrameworkCacheEntry,
  rememberFrameworkAction,
  resolveSessionPromptContext,
  setFrameworkCacheEntry,
  type FrameworkJsonObject,
  type FrameworkPromptContext,
  type FrameworkPromptContextClient,
  type FrameworkSessionKernelState,
  type FrameworkToolTarget,
  type SessionKernelStore,
} from "../kernel/index.ts";
import {
  DEFAULT_EDIT_FOCUSED_TOOLS,
  extractChangeTargets,
  filterPathsByRuleContent,
  findMatchingRules,
  hasMatchingWorkItem,
  loadMergedPolicyConfig,
  resolveRuleScope,
  ruleContentMatcherType,
  ruleMatchesPath,
  ruleMatchesTool,
  type GuardrailAction,
  type GuardrailChangeTarget,
  type GuardrailPolicyConfig,
  type GuardrailRule,
  type GuardrailSeverity,
} from "./config.ts";

const SERVICE = "groundwork-policy";
const POLICY_PACKET_SCHEMA_ID = "groundwork/policy-violation/v1";
const MUTATING_TOOLS = new Set<string>(DEFAULT_EDIT_FOCUSED_TOOLS);
const POLICY_RUNTIME_METADATA_KEY = "policyRuntime";
const POLICY_CONTENT_MATCH_CACHE_BUCKET = "policy-content-matches";
const POLICY_PENDING_OVERRIDE_LOCK_KEY = "policy-pending-override";
const POLICY_TERMINATION_LOCK_KEY = "policy-terminated";
const SEVERITY_ORDER: Record<GuardrailSeverity, number> = {
  advisory: 0,
  warn: 1,
  block: 2,
  terminate: 3,
};

type EvaluationPhase = "before" | "after";

type ParsedPolicyCommand =
  | {
      type: "override";
      reason: string;
    }
  | {
      type: "skill_loaded";
      skills: string[];
    };

type PolicyRuntimeState = {
  completedInjectOnlyRules: Set<string>;
  confirmedSkills: Set<string>;
  promptContextLoaded: boolean;
};

type PolicyHumanOverrideLock = {
  ruleId: string;
  message: string;
  paths: string[];
  createdAt: string;
};

type PolicySessionTermination = {
  ruleId: string;
  message: string;
  paths: string[];
  createdAt: string;
};

type FrameworkPolicyRuntimeClient = PluginInput["client"] & FrameworkPromptContextClient;

export interface CreateFrameworkPolicyLayerOptions {
  client: FrameworkPolicyRuntimeClient;
  directory: string;
  sessionStore?: SessionKernelStore;
  worktree?: string;
  env?: NodeJS.ProcessEnv;
}

export async function createFrameworkPolicyLayer(
  options: CreateFrameworkPolicyLayerOptions,
): Promise<GroundworkLayerRegistration> {
  const directory = path.resolve(options.directory);
  const rootDir = path.resolve(options.worktree ?? options.directory);
  const { config, projectPath, globalPath, sourceCount } = await loadMergedPolicyConfig(
    rootDir,
    options.env,
  );
  const sessionStore = options.sessionStore ?? createSessionKernelStore();

  await log(options.client, "info", "Framework policy runtime initialized", {
    rootDir,
    project_config_path: projectPath,
    global_config_path: globalPath,
    config_sources: sourceCount,
    rules: config?.rules.length ?? 0,
    enabled: Boolean(config),
  });

  if (!config) {
    await log(options.client, "info", "No policy config found; framework policy layer idle", {
      project_config_path: projectPath,
      global_config_path: globalPath,
    });
  }

  return {
    active: Boolean(config),
    hooks: {
      "chat.message": async ({ sessionID }, { parts }) => {
        if (!config) return;

        let state = getOrCreateSessionState(sessionStore, sessionID);
        const runtimeState = getPolicyRuntimeState(state);
        const commands = parsePolicyCommands(parts);
        if (commands.length === 0) {
          return;
        }

        for (const command of commands) {
          if (command.type === "override") {
            const hadLock = Boolean(getPendingHumanOverrideLock(state));
            clearPendingHumanOverrideLock(state);

            await log(options.client, hadLock ? "warn" : "info", "Policy override accepted", {
              sessionID,
              reason: command.reason,
              had_lock: hadLock,
            });

            await injectPolicyPrompt(
              options.client,
              state,
              runtimeState,
              sessionID,
              `Override accepted: ${command.reason}`,
            );
            continue;
          }

          for (const skill of command.skills) {
            runtimeState.confirmedSkills.add(normalizeSkillName(skill));
          }

          await log(options.client, "info", "Policy skill confirmation accepted", {
            sessionID,
            skills: command.skills,
          });
        }

        setPolicyRuntimeState(state, runtimeState);
        sessionStore.set(state);
      },

      "tool.execute.before": async ({ tool, callID, sessionID }, { args }) => {
        if (!config) return;

        let state = getOrCreateSessionState(sessionStore, sessionID);
        const runtimeState = getPolicyRuntimeState(state);
        enforceSessionStateGuards(state, tool);

        const extraction = extractFrameworkToolTargets(asToolArgs(args), {
          toolName: tool,
          directory,
          rootDir,
        });
        const targets = materializeGuardrailTargets(rootDir, extraction.targets, args);
        const normalizedPaths = targets.map((target) => target.normalizedPath);
        if (normalizedPaths.length === 0) {
          return;
        }

        if (MUTATING_TOOLS.has(tool)) {
          invalidateContentMatchCache(state, new Date().toISOString(), normalizedPaths);
        }

        state = await evaluateRulesForPhase({
          phase: "before",
          config,
          rootDir,
          tool,
          callID,
          sessionID,
          targets,
          client: options.client,
          sessionStore,
          state,
          runtimeState,
        });

        if (MUTATING_TOOLS.has(tool)) {
          state.pendingTools.calls[createPolicyPendingToolKey(callID)] = {
            callID,
            toolName: tool,
            phase: "after",
            capturedAt: new Date().toISOString(),
            targets: await snapshotFrameworkTargets(rootDir, extraction.targets),
            data: {
              source: SERVICE,
            },
          };
        }

        setPolicyRuntimeState(state, runtimeState);
        sessionStore.set(state);
      },

      "tool.execute.after": async ({ tool, callID, sessionID }) => {
        if (!config) return;

        let state = getOrCreateSessionState(sessionStore, sessionID);
        const pendingKey = createPolicyPendingToolKey(callID);
        const pending = state.pendingTools.calls[pendingKey];
        if (!pending) {
          return;
        }

        delete state.pendingTools.calls[pendingKey];
        state = sessionStore.set(state);

        const runtimeState = getPolicyRuntimeState(state);
        state = await evaluateRulesForPhase({
          phase: "after",
          config,
          rootDir,
          tool: pending.toolName || tool,
          callID,
          sessionID,
          targets: materializeGuardrailTargets(rootDir, pending.targets),
          client: options.client,
          sessionStore,
          state,
          runtimeState,
        });

        setPolicyRuntimeState(state, runtimeState);
        sessionStore.set(state);
      },

      event: async ({ event }) => {
        if (event.type !== "session.deleted") {
          return;
        }

        const sessionID = readEventSessionID(event.properties);
        if (!sessionID) {
          return;
        }

        sessionStore.cleanup(sessionID);
      },
    },
  };
}

function asToolArgs(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function getOrCreateSessionState(
  sessionStore: ReturnType<typeof createSessionKernelStore>,
  sessionID: string,
): FrameworkSessionKernelState {
  return sessionStore.get(sessionID) ?? sessionStore.create(sessionID);
}

function createPolicyPendingToolKey(callID: string): string {
  return `${SERVICE}::${callID}`;
}

function getPolicyRuntimeState(state: FrameworkSessionKernelState): PolicyRuntimeState {
  const rawRuntime =
    state.metadata && isRecord(state.metadata[POLICY_RUNTIME_METADATA_KEY])
      ? state.metadata[POLICY_RUNTIME_METADATA_KEY]
      : undefined;

  return {
    completedInjectOnlyRules: new Set(
      isStringArray(rawRuntime?.completedInjectOnlyRules)
        ? rawRuntime.completedInjectOnlyRules
        : [],
    ),
    confirmedSkills: new Set(
      isStringArray(rawRuntime?.confirmedSkills) ? rawRuntime.confirmedSkills : [],
    ),
    promptContextLoaded: rawRuntime?.promptContextLoaded === true,
  };
}

function setPolicyRuntimeState(
  state: FrameworkSessionKernelState,
  runtimeState: PolicyRuntimeState,
): void {
  const metadata: FrameworkJsonObject = state.metadata ? structuredClone(state.metadata) : {};
  metadata[POLICY_RUNTIME_METADATA_KEY] = {
    completedInjectOnlyRules: [...runtimeState.completedInjectOnlyRules].sort(),
    confirmedSkills: [...runtimeState.confirmedSkills].sort(),
    promptContextLoaded: runtimeState.promptContextLoaded,
  };
  state.metadata = metadata;
}

function getPendingHumanOverrideLock(
  state: FrameworkSessionKernelState,
): PolicyHumanOverrideLock | null {
  const lock = state.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY];
  if (!lock) {
    return null;
  }

  const ruleId =
    lock.metadata && typeof lock.metadata.ruleId === "string" ? lock.metadata.ruleId : lock.source;
  return {
    ruleId,
    message: lock.reason,
    paths: lock.paths ? [...lock.paths] : [],
    createdAt: lock.createdAt,
  };
}

function setPendingHumanOverrideLock(
  state: FrameworkSessionKernelState,
  lock: PolicyHumanOverrideLock,
): void {
  state.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY] = {
    scope: "mutating-tools",
    reason: lock.message,
    source: SERVICE,
    createdAt: lock.createdAt,
    paths: [...lock.paths],
    metadata: {
      ruleId: lock.ruleId,
    },
  };
}

function clearPendingHumanOverrideLock(state: FrameworkSessionKernelState): void {
  delete state.locks.active[POLICY_PENDING_OVERRIDE_LOCK_KEY];
}

function getTerminationLock(state: FrameworkSessionKernelState): PolicySessionTermination | null {
  const lock = state.locks.active[POLICY_TERMINATION_LOCK_KEY];
  if (!lock) {
    return null;
  }

  const ruleId =
    lock.metadata && typeof lock.metadata.ruleId === "string" ? lock.metadata.ruleId : lock.source;
  return {
    ruleId,
    message: lock.reason,
    paths: lock.paths ? [...lock.paths] : [],
    createdAt: lock.createdAt,
  };
}

function setTerminationLock(
  state: FrameworkSessionKernelState,
  termination: PolicySessionTermination,
): void {
  state.locks.active[POLICY_TERMINATION_LOCK_KEY] = {
    scope: "session",
    reason: termination.message,
    source: SERVICE,
    createdAt: termination.createdAt,
    paths: [...termination.paths],
    metadata: {
      ruleId: termination.ruleId,
    },
  };
}

function enforceSessionStateGuards(state: FrameworkSessionKernelState, tool: string): void {
  const termination = getTerminationLock(state);
  if (termination) {
    throw new FrameworkEnforcementError({
      message: `[groundwork:policy] Session is terminated by rule '${termination.ruleId}'. Start a new session to continue.`,
      source: SERVICE,
      code: termination.ruleId,
    });
  }

  const pendingHumanOverride = getPendingHumanOverrideLock(state);
  if (pendingHumanOverride && MUTATING_TOOLS.has(tool)) {
    throw new FrameworkEnforcementError({
      message: `[groundwork:policy] Mutating tools are locked by rule '${pendingHumanOverride.ruleId}'. Provide human override via '/policy override <reason>' to continue.`,
      source: SERVICE,
      code: pendingHumanOverride.ruleId,
    });
  }
}

async function evaluateRulesForPhase(params: {
  phase: EvaluationPhase;
  config: GuardrailPolicyConfig;
  rootDir: string;
  tool: string;
  callID: string;
  sessionID: string;
  targets: GuardrailChangeTarget[];
  client: FrameworkPolicyRuntimeClient;
  sessionStore: ReturnType<typeof createSessionKernelStore>;
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

    await log(client, "debug", "Policy rule matched", {
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

function resolveRuleSeverity(rule: GuardrailRule): GuardrailSeverity {
  if (rule.severity) return rule.severity;

  if (rule.actions.some((action) => action.type === "stop_session")) {
    return "terminate";
  }

  if (rule.actions.some((action) => !isInjectOnlyAction(action))) {
    return "block";
  }

  return "advisory";
}

function isInjectOnlyAction(action: GuardrailAction): boolean {
  if (action.type === "inject_prompt") return true;
  if (action.type === "ensure_skill_loaded" && (action.mode ?? "prompt") === "prompt") {
    return true;
  }

  return false;
}

function ruleAppliesToPhase(rule: GuardrailRule, phase: EvaluationPhase): boolean {
  const matcherType = ruleContentMatcherType(rule);
  if (resolveRuleScope(rule) === "changed_lines" && matcherType !== "none") {
    return phase === "after";
  }

  if (phase === "before") {
    return matcherType === "none" || matcherType === "ast_grep";
  }

  return matcherType === "semgrep";
}

async function filterPathsForRule(params: {
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

function readContentMatchCache(
  state: FrameworkSessionKernelState,
  ruleId: string,
  normalizedPath: string,
): boolean | undefined {
  const entry = getFrameworkCacheEntry(
    state,
    POLICY_CONTENT_MATCH_CACHE_BUCKET,
    createContentMatchCacheKey(ruleId, normalizedPath),
  );
  return typeof entry?.value === "boolean" ? entry.value : undefined;
}

function writeContentMatchCache(
  state: FrameworkSessionKernelState,
  now: string,
  ruleId: string,
  normalizedPath: string,
  value: boolean,
): void {
  setFrameworkCacheEntry(state, {
    bucket: POLICY_CONTENT_MATCH_CACHE_BUCKET,
    key: createContentMatchCacheKey(ruleId, normalizedPath),
    now,
    value,
  });
}

function invalidateContentMatchCache(
  state: FrameworkSessionKernelState,
  now: string,
  normalizedPaths: string[],
): void {
  const entries = state.caches.buckets[POLICY_CONTENT_MATCH_CACHE_BUCKET]?.entries;
  if (!entries) {
    return;
  }

  for (const key of Object.keys(entries)) {
    if (normalizedPaths.some((normalizedPath) => key.endsWith(`::${normalizedPath}`))) {
      clearFrameworkCacheEntry(state, {
        bucket: POLICY_CONTENT_MATCH_CACHE_BUCKET,
        key,
        now,
      });
    }
  }
}

async function executeAction(params: {
  action: GuardrailAction;
  actionIndex: number;
  phase: EvaluationPhase;
  tool: string;
  callID: string;
  sessionID: string;
  rule: GuardrailRule;
  ruleSeverity: GuardrailSeverity;
  normalizedPaths: string[];
  rootDir: string;
  client: FrameworkPolicyRuntimeClient;
  sessionStore: ReturnType<typeof createSessionKernelStore>;
  state: FrameworkSessionKernelState;
  runtimeState: PolicyRuntimeState;
}): Promise<void> {
  const {
    action,
    actionIndex,
    phase,
    tool,
    callID,
    sessionID,
    rule,
    ruleSeverity,
    normalizedPaths,
    rootDir,
    client,
    sessionStore,
    state,
    runtimeState,
  } = params;

  if (action.type === "inject_prompt") {
    const hit = rememberFrameworkAction(state, {
      source: SERVICE,
      action: "inject_prompt",
      parts: [rule.id, actionIndex, action.text],
      now: new Date().toISOString(),
    });
    if (hit.duplicate) {
      return;
    }

    await injectPolicyPrompt(client, state, runtimeState, sessionID, action.text);

    await log(client, "info", "Injected policy guidance", {
      tool,
      sessionID,
      rule_id: rule.id,
      action_index: actionIndex,
      once_per_session: action.once_per_session ?? false,
    });

    return;
  }

  if (action.type === "ensure_skill_loaded") {
    const missingSkills = action.skills.filter(
      (skill) => !runtimeState.confirmedSkills.has(normalizeSkillName(skill)),
    );
    if (missingSkills.length === 0) {
      return;
    }

    const mode = action.mode ?? "prompt";
    const message =
      action.message ??
      `[groundwork:policy] Required skills missing for rule '${rule.id}': ${missingSkills.join(", ")}. Confirm with '/policy skill-loaded ${missingSkills.join(" ")}'.`;

    const guidanceHit = rememberFrameworkAction(state, {
      source: SERVICE,
      action: "ensure_skill_loaded_guidance",
      parts: [rule.id, actionIndex, ...missingSkills.map(normalizeSkillName).sort()],
      now: new Date().toISOString(),
    });
    if (!guidanceHit.duplicate) {
      await injectPolicyPrompt(
        client,
        state,
        runtimeState,
        sessionID,
        `${message} Load the required skills before continuing.`,
      );
    }

    if (mode === "prompt") {
      return;
    }

    await enforceViolation({
      phase,
      tool,
      callID,
      sessionID,
      rule,
      actionType: action.type,
      severity: ruleSeverity,
      message,
      normalizedPaths,
      rootDir,
      client,
      sessionStore,
      state,
      runtimeState,
    });

    return;
  }

  if (action.type === "require_work_item") {
    for (const normalizedPath of normalizedPaths) {
      const covered = await hasMatchingWorkItem(rootDir, normalizedPath);
      if (covered) {
        continue;
      }

      await enforceViolation({
        phase,
        tool,
        callID,
        sessionID,
        rule,
        actionType: action.type,
        severity: ruleSeverity,
        message:
          action.message ??
          `[groundwork:policy] Path '${normalizedPath}' requires a matching active work item before tool execution (rule: ${rule.id})`,
        normalizedPaths: [normalizedPath],
        rootDir,
        client,
        sessionStore,
        state,
        runtimeState,
      });

      return;
    }

    return;
  }

  if (action.type === "block_tool") {
    await enforceViolation({
      phase,
      tool,
      callID,
      sessionID,
      rule,
      actionType: action.type,
      severity: ruleSeverity,
      message:
        action.message ??
        `[groundwork:policy] Tool execution blocked by policy rule '${rule.id}' for paths: ${normalizedPaths.join(", ")}`,
      normalizedPaths,
      rootDir,
      client,
      sessionStore,
      state,
      runtimeState,
    });

    return;
  }

  if (action.type === "require_human_override") {
    if (isBlockingSeverity(ruleSeverity)) {
      setPendingHumanOverrideLock(state, {
        ruleId: rule.id,
        message:
          action.message ??
          `Rule '${rule.id}' requires explicit human override. Use '/policy override <reason>' to unlock mutating tools.`,
        paths: [...normalizedPaths],
        createdAt: new Date().toISOString(),
      });
    }

    await enforceViolation({
      phase,
      tool,
      callID,
      sessionID,
      rule,
      actionType: action.type,
      severity: ruleSeverity,
      message:
        action.message ??
        `[groundwork:policy] Rule '${rule.id}' requires explicit human override. Use '/policy override <reason>' to continue.`,
      normalizedPaths,
      rootDir,
      client,
      sessionStore,
      state,
      runtimeState,
    });

    return;
  }

  if (action.type === "stop_session") {
    await enforceViolation({
      phase,
      tool,
      callID,
      sessionID,
      rule,
      actionType: action.type,
      severity: "terminate",
      message:
        action.message ??
        `[groundwork:policy] Session terminated due to critical policy violation in rule '${rule.id}'.`,
      normalizedPaths,
      rootDir,
      client,
      sessionStore,
      state,
      runtimeState,
      forceTerminate: true,
    });
  }
}

async function enforceViolation(params: {
  phase: EvaluationPhase;
  tool: string;
  callID: string;
  sessionID: string;
  rule: GuardrailRule;
  actionType: GuardrailAction["type"];
  severity: GuardrailSeverity;
  message: string;
  normalizedPaths: string[];
  rootDir: string;
  client: FrameworkPolicyRuntimeClient;
  sessionStore: ReturnType<typeof createSessionKernelStore>;
  state: FrameworkSessionKernelState;
  runtimeState: PolicyRuntimeState;
  forceTerminate?: boolean;
}): Promise<never | void> {
  const {
    phase,
    tool,
    callID,
    sessionID,
    rule,
    actionType,
    severity,
    message,
    normalizedPaths,
    rootDir,
    client,
    sessionStore,
    state,
    runtimeState,
    forceTerminate = false,
  } = params;

  await writeViolationArtifact({
    rootDir,
    sessionID,
    ruleId: rule.id,
    severity,
    actionType,
    tool,
    phase,
    callID,
    message,
    paths: normalizedPaths,
    blocking: forceTerminate || isBlockingSeverity(severity),
  });

  await log(client, severityToLogLevel(severity), "Policy violation", {
    phase,
    tool,
    callID,
    sessionID,
    rule_id: rule.id,
    action_type: actionType,
    severity,
    paths: normalizedPaths,
    message,
  });

  if (!forceTerminate && !isBlockingSeverity(severity)) {
    return;
  }

  if (forceTerminate || severity === "terminate") {
    setTerminationLock(state, {
      ruleId: rule.id,
      message,
      paths: [...normalizedPaths],
      createdAt: new Date().toISOString(),
    });

    if (typeof client.session.abort === "function") {
      try {
        await client.session.abort({ path: { id: sessionID } });
      } catch {
        // ignore abort API failures; local termination state still wins.
      }
    }
  }

  setPolicyRuntimeState(state, runtimeState);
  sessionStore.set(state);
  throw new FrameworkEnforcementError({
    message,
    source: SERVICE,
    code: actionType,
  });
}

async function writeViolationArtifact(params: {
  rootDir: string;
  sessionID: string;
  ruleId: string;
  severity: GuardrailSeverity;
  actionType: GuardrailAction["type"];
  tool: string;
  phase: EvaluationPhase;
  callID: string;
  message: string;
  paths: string[];
  blocking: boolean;
}): Promise<void> {
  const {
    rootDir,
    sessionID,
    ruleId,
    severity,
    actionType,
    tool,
    phase,
    callID,
    message,
    paths,
    blocking,
  } = params;

  const timestamp = new Date().toISOString();
  const messagesDir = path.join(rootDir, ".agents", "messages");
  const fileName = `${timestamp.replace(/[:.]/g, "-")}-groundwork-policy-${sanitizeFilePart(ruleId)}.json`;
  const filePath = path.join(messagesDir, fileName);
  const data = {
    kind: "policy_violation",
    session_id: sessionID,
    rule_id: ruleId,
    severity,
    action_type: actionType,
    tool,
    phase,
    call_id: callID,
    message,
    paths,
  } satisfies {
    kind: "policy_violation";
    session_id: string;
    rule_id: string;
    severity: GuardrailSeverity;
    action_type: GuardrailAction["type"];
    tool: string;
    phase: EvaluationPhase;
    call_id: string;
    message: string;
    paths: string[];
  };
  const summary = `Policy violation for rule '${ruleId}' on ${tool}: ${message}`;
  const packet = {
    from: SERVICE,
    to: "all",
    phase: "review",
    type: "artifact",
    content: {
      summary,
      data,
    },
    metadata: {
      timestamp,
      schema_id: POLICY_PACKET_SCHEMA_ID,
      parent_packet: null,
      blocking,
    },
  } satisfies {
    from: typeof SERVICE;
    to: "all";
    phase: "review";
    type: "artifact";
    content: {
      summary: string;
      data: typeof data;
    };
    metadata: {
      timestamp: string;
      schema_id: typeof POLICY_PACKET_SCHEMA_ID;
      parent_packet: null;
      blocking: boolean;
    };
  };

  try {
    await fs.mkdir(messagesDir, { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(packet, null, 2)}\n`, "utf8");
  } catch {
    // ignore artifact write failures so enforcement still proceeds.
  }
}

function materializeGuardrailTargets(
  rootDir: string,
  targets: readonly FrameworkToolTarget[],
  args?: unknown,
): GuardrailChangeTarget[] {
  const merged = new Map<string, GuardrailChangeTarget>();

  for (const target of targets) {
    const normalizedPath = target.normalizedPath ?? target.afterPath ?? target.beforePath;
    if (!normalizedPath) {
      continue;
    }

    mergeGuardrailTarget(merged, {
      normalizedPath,
      beforeContent: readTargetBeforeContent(target),
      changedLineRanges: cloneLineRanges(target.changedLineRanges),
      deletedLineRanges: cloneLineRanges(target.deletedLineRanges),
    });
  }

  for (const patchText of collectPatchPayloads(args)) {
    for (const patchTarget of extractChangeTargets(rootDir, { patchText })) {
      if (!merged.has(patchTarget.normalizedPath)) {
        continue;
      }

      mergeGuardrailTarget(merged, patchTarget);
    }
  }

  return Array.from(merged.values());
}

function readTargetBeforeContent(target: FrameworkToolTarget): string | null | undefined {
  const beforeContent = target.metadata && target.metadata.beforeContent;
  return typeof beforeContent === "string" || beforeContent === null ? beforeContent : undefined;
}

function cloneLineRanges(
  ranges: FrameworkToolTarget["changedLineRanges"] | FrameworkToolTarget["deletedLineRanges"],
): GuardrailChangeTarget["changedLineRanges"] | GuardrailChangeTarget["deletedLineRanges"] {
  return ranges?.map((range) => ({
    startLine: range.startLine,
    endLine: range.endLine,
  }));
}

function mergeGuardrailTarget(
  out: Map<string, GuardrailChangeTarget>,
  incoming: GuardrailChangeTarget,
): void {
  const existing = out.get(incoming.normalizedPath);
  if (!existing) {
    out.set(incoming.normalizedPath, {
      normalizedPath: incoming.normalizedPath,
      beforeContent: incoming.beforeContent,
      changedLineRanges: cloneLineRanges(incoming.changedLineRanges),
      deletedLineRanges: cloneLineRanges(incoming.deletedLineRanges),
    });
    return;
  }

  out.set(incoming.normalizedPath, {
    normalizedPath: incoming.normalizedPath,
    beforeContent: existing.beforeContent ?? incoming.beforeContent,
    changedLineRanges: mergeLineRanges(existing.changedLineRanges, incoming.changedLineRanges),
    deletedLineRanges: mergeLineRanges(existing.deletedLineRanges, incoming.deletedLineRanges),
  });
}

function mergeLineRanges(
  left: GuardrailChangeTarget["changedLineRanges"],
  right: GuardrailChangeTarget["changedLineRanges"],
): GuardrailChangeTarget["changedLineRanges"] {
  const combined = [...(left ?? []), ...(right ?? [])]
    .map((range) => ({ ...range }))
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
  if (combined.length === 0) {
    return undefined;
  }

  const merged = [combined[0]!];
  for (const current of combined.slice(1)) {
    const previous = merged[merged.length - 1]!;
    if (current.startLine <= previous.endLine + 1) {
      previous.endLine = Math.max(previous.endLine, current.endLine);
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function collectPatchPayloads(value: unknown, keyName?: string): string[] {
  if (typeof value === "string") {
    const normalizedKey = keyName?.toLowerCase();
    return normalizedKey === "patch" || normalizedKey === "patchtext" ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPatchPayloads(entry, keyName));
  }

  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([childKey, childValue]) =>
    collectPatchPayloads(childValue, childKey),
  );
}

async function snapshotFrameworkTargets(
  rootDir: string,
  targets: readonly FrameworkToolTarget[],
): Promise<FrameworkToolTarget[]> {
  return Promise.all(
    targets.map(async (target) => {
      const beforeContentPath = target.beforePath ?? target.normalizedPath ?? target.afterPath;
      const metadata: FrameworkJsonObject = target.metadata ? structuredClone(target.metadata) : {};

      if (!beforeContentPath) {
        metadata.beforeContent = null;
      } else {
        try {
          metadata.beforeContent = await fs.readFile(
            path.resolve(rootDir, beforeContentPath),
            "utf8",
          );
        } catch {
          metadata.beforeContent = null;
        }
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

async function injectPolicyPrompt(
  client: FrameworkPolicyRuntimeClient,
  state: FrameworkSessionKernelState,
  runtimeState: PolicyRuntimeState,
  sessionID: string,
  text: string,
): Promise<void> {
  const promptContext = await resolvePolicyPromptContext(client, state, runtimeState, sessionID);
  if (!promptContext) {
    await log(client, "warn", "Skipping policy prompt injection - missing session prompt context", {
      sessionID,
    });
    return;
  }

  await client.session.prompt({
    path: { id: sessionID },
    body: {
      ...toSessionPromptContext(promptContext),
      noReply: true,
      parts: [
        {
          type: "text",
          text: `[groundwork:policy] ${text}`,
          synthetic: false,
        },
      ],
    },
  });
}

async function resolvePolicyPromptContext(
  client: FrameworkPolicyRuntimeClient,
  state: FrameworkSessionKernelState,
  runtimeState: PolicyRuntimeState,
  sessionID: string,
): Promise<FrameworkPromptContext | null> {
  if (state.promptContext) {
    runtimeState.promptContextLoaded = true;
    return state.promptContext;
  }

  if (runtimeState.promptContextLoaded) {
    return null;
  }

  runtimeState.promptContextLoaded = true;
  const promptContext = await resolveSessionPromptContext(client, sessionID, { limit: 10 });
  if (promptContext) {
    state.promptContext = promptContext;
  }

  return promptContext;
}

function toSessionPromptContext(promptContext: FrameworkPromptContext): {
  messageID?: string;
  agent?: string;
  model?: FrameworkPromptContext["model"];
  system?: string;
  variant?: string;
  tools?: Record<string, boolean>;
} {
  return {
    messageID: promptContext.messageID,
    agent: promptContext.agent,
    model: promptContext.model,
    system: promptContext.system,
    variant: promptContext.variant,
    tools: normalizePromptTools(promptContext.tools),
  };
}

function normalizePromptTools(
  tools: FrameworkPromptContext["tools"],
): Record<string, boolean> | undefined {
  if (!tools) {
    return undefined;
  }

  const result: Record<string, boolean> = {};
  for (const [toolName, enabled] of Object.entries(tools)) {
    if (typeof enabled === "boolean") {
      result[toolName] = enabled;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parsePolicyCommands(parts: unknown): ParsedPolicyCommand[] {
  if (!Array.isArray(parts)) return [];

  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const maybePart = part as { type?: unknown; text?: unknown };
      if (maybePart.type !== "text") return "";
      return typeof maybePart.text === "string" ? maybePart.text : "";
    })
    .filter((entry) => entry.length > 0)
    .join("\n");

  if (text.length === 0) return [];

  const commands: ParsedPolicyCommand[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("/policy ")) continue;

    if (trimmed.startsWith("/policy override ")) {
      const reason = trimmed.slice("/policy override ".length).trim();
      if (reason.length > 0) {
        commands.push({ type: "override", reason });
      }
      continue;
    }

    if (trimmed.startsWith("/policy skill-loaded ")) {
      const skillsRaw = trimmed.slice("/policy skill-loaded ".length);
      const skills = skillsRaw
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (skills.length > 0) {
        commands.push({ type: "skill_loaded", skills });
      }
    }
  }

  return commands;
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase();
}

function isBlockingSeverity(severity: GuardrailSeverity): boolean {
  return SEVERITY_ORDER[severity] >= SEVERITY_ORDER.block;
}

function severityToLogLevel(severity: GuardrailSeverity): "info" | "warn" | "error" {
  if (severity === "advisory") return "info";
  if (severity === "warn") return "warn";
  return "error";
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80);
}

function createContentMatchCacheKey(ruleId: string, normalizedPath: string): string {
  return `${ruleId}::${normalizedPath}`;
}

function readEventSessionID(properties: unknown): string | null {
  if (!isRecord(properties)) {
    return null;
  }

  if (typeof properties.id === "string" && properties.id.length > 0) {
    return properties.id;
  }

  if (typeof properties.sessionID === "string" && properties.sessionID.length > 0) {
    return properties.sessionID;
  }

  return null;
}

async function log(
  client: FrameworkPolicyRuntimeClient,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: SERVICE,
        level,
        message,
        extra,
      },
    });
  } catch {
    // ignore logging failures
  }
}
