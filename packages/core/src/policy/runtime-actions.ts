import { FrameworkEnforcementError } from "../layer/dispatcher.ts";
import { rememberFrameworkAction } from "../kernel/helpers.ts";
import { logFrameworkEvent } from "../logger/events.ts";
import type {
  GuardrailAction,
  GuardrailRule,
  GuardrailSeverity,
} from "./config.ts";
import { normalizeSkillName } from "./runtime-commands.ts";
import { injectPolicyPrompt } from "./runtime-prompt.ts";
import {
  isBlockingSeverity,
  setPendingHumanOverrideLock,
  setPolicyRuntimeState,
  setTerminationLock,
  severityToLogLevel,
} from "./runtime-state.ts";
import {
  SERVICE,
  type ExecuteActionParams,
  type PolicyActionOf,
} from "./runtime-types.ts";

export function resolveRuleSeverity(rule: GuardrailRule): GuardrailSeverity {
  if (rule.severity) return rule.severity;

  if (rule.actions.some((action) => action.type === "stop_session")) {
    return "terminate";
  }

  if (rule.actions.some((action) => !isInjectOnlyAction(action))) {
    return "block";
  }

  return "advisory";
}

export function isInjectOnlyAction(action: GuardrailAction): boolean {
  if (action.type === "inject_prompt") return true;
  if (action.type === "ensure_skill_loaded" && (action.mode ?? "prompt") === "prompt") {
    return true;
  }

  return false;
}

export async function executeAction(params: ExecuteActionParams): Promise<void> {
  switch (params.action.type) {
    case "inject_prompt":
      return executeInjectPromptAction(
        params as ExecuteActionParams<PolicyActionOf<"inject_prompt">>,
      );
    case "ensure_skill_loaded":
      return executeEnsureSkillLoadedAction(
        params as ExecuteActionParams<PolicyActionOf<"ensure_skill_loaded">>,
      );
    case "block_tool":
      return executeBlockToolAction(params as ExecuteActionParams<PolicyActionOf<"block_tool">>);
    case "require_human_override":
      return executeRequireHumanOverrideAction(
        params as ExecuteActionParams<PolicyActionOf<"require_human_override">>,
      );
    case "stop_session":
      return executeStopSessionAction(
        params as ExecuteActionParams<PolicyActionOf<"stop_session">>,
      );
  }
}

async function executeInjectPromptAction(
  params: ExecuteActionParams<PolicyActionOf<"inject_prompt">>,
): Promise<void> {
  const { action, actionIndex, tool, sessionID, rule, client, state, runtimeState } = params;
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
  await logFrameworkEvent(client, SERVICE, "info", "Injected policy guidance", {
    tool,
    sessionID,
    rule_id: rule.id,
    action_index: actionIndex,
    once_per_session: action.once_per_session ?? false,
  });
}

async function executeEnsureSkillLoadedAction(
  params: ExecuteActionParams<PolicyActionOf<"ensure_skill_loaded">>,
): Promise<void> {
  const { action, actionIndex, sessionID, rule, state, runtimeState, client } = params;
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

  await enforceViolationForAction(params, message);
}

async function executeBlockToolAction(
  params: ExecuteActionParams<PolicyActionOf<"block_tool">>,
): Promise<void> {
  const { action, normalizedPaths, rule } = params;
  await enforceViolationForAction(
    params,
    action.message ??
      `[groundwork:policy] Tool execution blocked by policy rule '${rule.id}' for paths: ${normalizedPaths.join(", ")}`,
  );
}

async function executeRequireHumanOverrideAction(
  params: ExecuteActionParams<PolicyActionOf<"require_human_override">>,
): Promise<void> {
  const { action, normalizedPaths, rule, ruleSeverity, state } = params;
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

  await enforceViolationForAction(
    params,
    action.message ??
      `[groundwork:policy] Rule '${rule.id}' requires explicit human override. Use '/policy override <reason>' to continue.`,
  );
}

async function executeStopSessionAction(
  params: ExecuteActionParams<PolicyActionOf<"stop_session">>,
): Promise<void> {
  const { action, rule } = params;
  await enforceViolationForAction(
    params,
    action.message ??
      `[groundwork:policy] Session terminated due to critical policy violation in rule '${rule.id}'.`,
    undefined,
    { severity: "terminate", forceTerminate: true },
  );
}

async function enforceViolationForAction(
  params: ExecuteActionParams,
  message: string,
  normalizedPaths = params.normalizedPaths,
  options: { severity?: GuardrailSeverity; forceTerminate?: boolean } = {},
): Promise<void> {
  await enforceViolation({
    phase: params.phase,
    tool: params.tool,
    callID: params.callID,
    sessionID: params.sessionID,
    rule: params.rule,
    actionType: params.action.type,
    severity: options.severity ?? params.ruleSeverity,
    message,
    normalizedPaths,
    rootDir: params.rootDir,
    client: params.client,
    sessionStore: params.sessionStore,
    state: params.state,
    runtimeState: params.runtimeState,
    forceTerminate: options.forceTerminate,
  });
}

async function enforceViolation(params: {
  phase: ExecuteActionParams["phase"];
  tool: string;
  callID: string;
  sessionID: string;
  rule: ExecuteActionParams["rule"];
  actionType: GuardrailAction["type"];
  severity: GuardrailSeverity;
  message: string;
  normalizedPaths: string[];
  rootDir: string;
  client: ExecuteActionParams["client"];
  sessionStore: ExecuteActionParams["sessionStore"];
  state: ExecuteActionParams["state"];
  runtimeState: ExecuteActionParams["runtimeState"];
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
    client,
    sessionStore,
    state,
    runtimeState,
    forceTerminate = false,
  } = params;

  await logFrameworkEvent(client, SERVICE, severityToLogLevel(severity), "Policy violation", {
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
