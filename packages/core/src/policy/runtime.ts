import path from "node:path";
import type { GroundworkLayerRegistration } from "../layer/dispatcher.ts";
import { createFrameworkSessionCleanupEventHook } from "../layer/session-cleanup.ts";
import { createSessionKernelStore, type FrameworkSessionKernelState } from "../kernel/state.ts";
import { extractFrameworkToolTargets } from "../kernel/tool-targets.ts";
import { logFrameworkEvent } from "../logger/events.ts";
import { loadMergedPolicyConfig } from "./config.ts";
import { normalizeSkillName, parsePolicyCommands } from "./runtime-commands.ts";
import { evaluateRulesForPhase } from "./runtime-evaluation.ts";
import { injectPolicyPrompt } from "./runtime-prompt.ts";
import {
  asToolArgs,
  clearPendingHumanOverrideLock,
  createPolicyPendingToolKey,
  enforceSessionStateGuards,
  getOrCreateSessionState,
  getPendingHumanOverrideLock,
  getPolicyRuntimeState,
  setPolicyRuntimeState,
} from "./runtime-state.ts";
import {
  materializeGuardrailTargets,
  snapshotFrameworkTargets,
} from "./runtime-targets.ts";
import {
  MUTATING_TOOLS,
  SERVICE,
  type CreateFrameworkPolicyLayerOptions,
  type ParsedPolicyCommand,
  type PolicyLayerRuntime,
  type PolicyRuntimeState,
} from "./runtime-types.ts";
import { invalidateContentMatchCache } from "./runtime-cache.ts";

export type { CreateFrameworkPolicyLayerOptions } from "./runtime-types.ts";

export async function createFrameworkPolicyLayer(
  options: CreateFrameworkPolicyLayerOptions,
): Promise<GroundworkLayerRegistration> {
  const directory = path.resolve(options.directory);
  const rootDir = path.resolve(options.worktree ?? options.directory);
  const { config, projectPath, globalPath, projectPaths, globalPaths, sourceCount } =
    await loadMergedPolicyConfig(rootDir, options.env);
  const sessionStore = options.sessionStore ?? createSessionKernelStore();

  await logFrameworkEvent(
    options.client,
    SERVICE,
    "info",
    "Framework policy runtime initialized",
    {
      rootDir,
      project_config_path: projectPath,
      global_config_path: globalPath,
      project_config_paths: projectPaths,
      global_config_paths: globalPaths,
      config_sources: sourceCount,
      rules: config?.rules.length ?? 0,
      enabled: Boolean(config),
    },
  );

  if (!config) {
    await logFrameworkEvent(
      options.client,
      SERVICE,
      "info",
      "No policy config found; framework policy layer idle",
      {
        project_config_path: projectPath,
        global_config_path: globalPath,
        project_config_paths: projectPaths,
        global_config_paths: globalPaths,
      },
    );
  }

  return {
    active: Boolean(config),
    hooks: createPolicyLayerHooks({
      client: options.client,
      directory,
      ownSessionCleanup: options.ownSessionCleanup ?? true,
      rootDir,
      config,
      sessionStore,
    }),
  };
}

function createPolicyLayerHooks(runtime: PolicyLayerRuntime): GroundworkLayerRegistration["hooks"] {
  return {
    "chat.message": async ({ sessionID }, { parts }) => {
      await handlePolicyChatMessage(runtime, sessionID, parts);
    },

    "tool.execute.before": async ({ tool, callID, sessionID }, { args }) => {
      await handlePolicyToolBefore(runtime, tool, callID, sessionID, args);
    },

    "tool.execute.after": async ({ tool, callID, sessionID }) => {
      await handlePolicyToolAfter(runtime, tool, callID, sessionID);
    },

    ...(runtime.ownSessionCleanup
      ? { event: createFrameworkSessionCleanupEventHook(runtime.sessionStore) }
      : {}),
  };
}

async function handlePolicyChatMessage(
  runtime: PolicyLayerRuntime,
  sessionID: string,
  parts: unknown,
): Promise<void> {
  if (!runtime.config) return;

  const state = getOrCreateSessionState(runtime.sessionStore, sessionID);
  const runtimeState = getPolicyRuntimeState(state);
  const commands = parsePolicyCommands(parts);
  if (commands.length === 0) {
    return;
  }

  for (const command of commands) {
    await applyPolicyCommand(runtime, state, runtimeState, sessionID, command);
  }

  setPolicyRuntimeState(state, runtimeState);
  runtime.sessionStore.set(state);
}

async function applyPolicyCommand(
  runtime: PolicyLayerRuntime,
  state: FrameworkSessionKernelState,
  runtimeState: PolicyRuntimeState,
  sessionID: string,
  command: ParsedPolicyCommand,
): Promise<void> {
  if (command.type === "override") {
    const hadLock = Boolean(getPendingHumanOverrideLock(state));
    clearPendingHumanOverrideLock(state);

    await logFrameworkEvent(
      runtime.client,
      SERVICE,
      hadLock ? "warn" : "info",
      "Policy override accepted",
      {
        sessionID,
        reason: command.reason,
        had_lock: hadLock,
      },
    );

    await injectPolicyPrompt(
      runtime.client,
      state,
      runtimeState,
      sessionID,
      `Override accepted: ${command.reason}`,
    );
    return;
  }

  for (const skill of command.skills) {
    runtimeState.confirmedSkills.add(normalizeSkillName(skill));
  }

  await logFrameworkEvent(runtime.client, SERVICE, "info", "Policy skill confirmation accepted", {
    sessionID,
    skills: command.skills,
  });
}

async function handlePolicyToolBefore(
  runtime: PolicyLayerRuntime,
  tool: string,
  callID: string,
  sessionID: string,
  args: unknown,
): Promise<void> {
  const { config } = runtime;
  if (!config) return;

  let state = getOrCreateSessionState(runtime.sessionStore, sessionID);
  const runtimeState = getPolicyRuntimeState(state);
  enforceSessionStateGuards(state, tool);

  const extraction = extractFrameworkToolTargets(asToolArgs(args), {
    toolName: tool,
    directory: runtime.directory,
    rootDir: runtime.rootDir,
  });
  const targets = materializeGuardrailTargets(runtime.rootDir, extraction.targets, args);
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
    rootDir: runtime.rootDir,
    tool,
    callID,
    sessionID,
    targets,
    client: runtime.client,
    sessionStore: runtime.sessionStore,
    state,
    runtimeState,
  });

  if (MUTATING_TOOLS.has(tool)) {
    state.pendingTools.calls[createPolicyPendingToolKey(callID)] = {
      callID,
      toolName: tool,
      phase: "after",
      capturedAt: new Date().toISOString(),
      targets: await snapshotFrameworkTargets(runtime.rootDir, extraction.targets),
      data: {
        source: SERVICE,
      },
    };
  }

  setPolicyRuntimeState(state, runtimeState);
  runtime.sessionStore.set(state);
}

async function handlePolicyToolAfter(
  runtime: PolicyLayerRuntime,
  tool: string,
  callID: string,
  sessionID: string,
): Promise<void> {
  const { config } = runtime;
  if (!config) return;

  let state = getOrCreateSessionState(runtime.sessionStore, sessionID);
  const pendingKey = createPolicyPendingToolKey(callID);
  const pending = state.pendingTools.calls[pendingKey];
  if (!pending) {
    return;
  }

  delete state.pendingTools.calls[pendingKey];
  state = runtime.sessionStore.set(state);

  const runtimeState = getPolicyRuntimeState(state);
  state = await evaluateRulesForPhase({
    phase: "after",
    config,
    rootDir: runtime.rootDir,
    tool: pending.toolName,
    callID,
    sessionID,
    targets: materializeGuardrailTargets(runtime.rootDir, pending.targets),
    client: runtime.client,
    sessionStore: runtime.sessionStore,
    state,
    runtimeState,
  });

  setPolicyRuntimeState(state, runtimeState);
  runtime.sessionStore.set(state);
}
