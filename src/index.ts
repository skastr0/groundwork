import type { Plugin } from "@opencode-ai/plugin";
import { createSessionKernelStore } from "./kernel/index.ts";
import {
  createGroundworkLayer,
  GROUNDWORK_LAYER_META,
} from "./layer/index.ts";
import { initLogger, logger } from "./logger/index.ts";
import { createFrameworkRiskLayer } from "./risk/index.ts";
import { createFrameworkPolicyLayer } from "./policy/index.ts";
import { createFrameworkProvenanceLayer } from "./provenance/index.ts";
import { createFrameworkContextLayer } from "./context/index.ts";

export {
  applyFrameworkCollectionBudget,
  applyFrameworkEvidenceBudget,
  applyFrameworkPromptBudget,
  clearFrameworkCacheEntry,
  createFrameworkActionDedupeKey,
  createFrameworkDedupeKey,
  createFrameworkSyntheticInjectionDedupeKey,
  cleanupSessionKernelState,
  cleanupSessionKernelStates,
  createSessionKernelState,
  createSessionKernelStore,
  extractFrameworkToolTargets,
  FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS,
  FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS,
  getFrameworkCacheEntry,
  rememberFrameworkAction,
  rememberFrameworkSyntheticInjection,
  resolveSessionPromptContext,
  setFrameworkCacheEntry,
  truncateFrameworkTextByBytes,
} from "./kernel/index.ts";
export {
  createFrameworkPolicyLayer,
  loadMergedPolicyConfig,
  loadPolicyConfig,
  mergePolicyConfigs,
  parsePolicyConfig,
  resolveGlobalPolicyConfigPath,
  resolveGlobalPolicyConfigPaths,
  resolvePolicyConfigPath,
  resolveProjectPolicyConfigPath,
  resolveProjectPolicyConfigPaths,
} from "./policy/index.ts";
export {
  augmentFrameworkToolDescription,
  applyFrameworkAmbientBudget,
  createFrameworkProvenanceLayer,
  classifyFrameworkAmbientTool,
  createFrameworkCompactionContextHook,
  createFrameworkSystemTransformHook,
  createFrameworkToolDefinitionHook,
  FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS,
  FRAMEWORK_AMBIENT_CAPTURE_STRATEGY_VALUES,
  FRAMEWORK_AMBIENT_PROVENANCE_TOOL_VALUES,
  FRAMEWORK_AMBIENT_QUERY_STRATEGY_VALUES,
  FRAMEWORK_COMPACTION_CONTEXT_MAX_BYTES,
  FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE,
  FRAMEWORK_SYSTEM_TRANSFORM_MAX_BYTES,
  renderFrameworkCompactionContext,
  renderFrameworkSystemTransformGuidance,
  renderFrameworkToolDefinitionGuidance,
} from "./provenance/index.ts";
export {
  DEFAULT_GUARD_CONFIG,
  configFromEnv,
  createFrameworkRiskLayer,
  createRiskToolBeforeHook,
  evaluateBashCommand,
} from "./risk/index.ts";
export {
  createFrameworkContextLayer,
  discoverFrameworkContextFiles,
  FRAMEWORK_CONTEXT_INJECTION_MAX_BYTES,
  FRAMEWORK_CONTEXT_INJECTION_MAX_ITEMS,
  FRAMEWORK_CONTEXT_RULE_FILES,
} from "./context/index.ts";
export type {
  ApplyFrameworkBudgetOptions,
  CreateSessionKernelStateOptions,
  CreateFrameworkActionDedupeKeyOptions,
  FrameworkBudgetBound,
  FrameworkBudgetLedger,
  FrameworkBudgetResult,
  FrameworkBudgetState,
  FrameworkBudgetUnit,
  FrameworkCacheBucket,
  FrameworkCacheEntry,
  FrameworkCacheState,
  FrameworkDedupeHit,
  FrameworkIgnoredToolTarget,
  FrameworkIgnoredToolTargetReason,
  FrameworkJsonArray,
  FrameworkJsonObject,
  FrameworkJsonPrimitive,
  FrameworkJsonValue,
  FrameworkLineRange,
  FrameworkLockScope,
  FrameworkLockState,
  FrameworkModelRef,
  FrameworkPendingToolCall,
  FrameworkPendingToolPhase,
  FrameworkPendingToolState,
  FrameworkPromptContextClient,
  FrameworkPromptContextMessage,
  FrameworkPromptContextMessageInfo,
  FrameworkPromptContextMessagesResult,
  FrameworkPromptContext,
  FrameworkSessionKernelState,
  FrameworkSessionLock,
  FrameworkToolTarget,
  FrameworkToolTargetExtraction,
  FrameworkToolTargetPatchAction,
  FrameworkToolTargetSource,
  FrameworkToolTargetSourceKind,
  RememberFrameworkActionOptions,
  RememberFrameworkSyntheticInjectionOptions,
  SessionKernelStore,
} from "./kernel/index.ts";
export type {
  AstGrepContentMatcher,
  AstGrepStrictness,
  CreateFrameworkPolicyLayerOptions,
  GuardrailAction,
  GuardrailContentMatcher,
  GuardrailContentScope,
  GuardrailMatcherExpectation,
  GuardrailPolicyConfig,
  GuardrailRule,
  GuardrailSeverity,
  GuardrailSkillEnforcementMode,
  SemgrepContentMatcher,
  SemgrepSeverity,
} from "./policy/index.ts";
export type {
  CreateFrameworkRiskLayerOptions,
  GuardConfig,
  GuardDecision,
  GuardMode,
  GuardSeverity,
  GuardViolation,
} from "./risk/index.ts";
export type { CreateFrameworkProvenanceLayerOptions } from "./provenance/index.ts";
export type {
  ApplyFrameworkAmbientBudgetOptions,
  FrameworkAmbientBudgetApplicationResult,
  FrameworkAmbientBudgetPhase,
  FrameworkAmbientCaptureStrategy,
  FrameworkAmbientCaptureStrategyName,
  FrameworkAmbientProvenanceToolName,
  FrameworkAmbientQueryStrategy,
  FrameworkAmbientQueryStrategyName,
  FrameworkAmbientStrategyBudget,
  FrameworkAmbientToolClassification,
  FrameworkSupportedAmbientToolClassification,
  FrameworkUnsupportedAmbientToolClassification,
} from "./provenance/index.ts";
export type {
  CreateFrameworkContextLayerOptions,
  DiscoverFrameworkContextFilesOptions,
  FrameworkDiscoveredContextFile,
  FrameworkContextRuleFileName,
} from "./context/index.ts";
export { initLogger, logger } from "./logger/index.ts";
export {
  createGroundworkHookDispatcher,
  createGroundworkLayer,
  GROUNDWORK_HOOK_SURFACE,
  GROUNDWORK_LAYER_META,
  GROUNDWORK_LAYER_ORDER,
  EMPTY_GROUNDWORK_LAYER,
  FrameworkEnforcementError,
  isFrameworkEnforcementError,
  materializeGroundworkLayers,
} from "./layer/index.ts";
export type {
  GroundworkDispatcher,
  GroundworkHookName,
  GroundworkLayerHooks,
  GroundworkLayerRegistration,
  GroundworkLayerRegistry,
  GroundworkLayerSlot,
  GroundworkToolDefinitionHook,
  GroundworkToolDefinitionHookInput,
  GroundworkToolDefinitionHookOutput,
  GroundworkToolDefinitions,
  MaterializedGroundworkLayer,
} from "./layer/index.ts";

export const GroundworkPlugin: Plugin = async ({ $, client, directory, worktree }) => {
  initLogger(client);
  logger.info(
    "Groundwork composition root initialized",
    GROUNDWORK_LAYER_META,
  );

  const sessionStore = createSessionKernelStore();

  const policy = await createFrameworkPolicyLayer({
    client,
    directory,
    sessionStore,
    worktree,
  });
  const context = await createFrameworkContextLayer({
    client,
    directory,
    sessionStore,
    worktree,
  });
  const provenance = await createFrameworkProvenanceLayer({
    directory,
    sessionStore,
    shell: $,
    rootDir: worktree,
  });
  const mutationRisk = await createFrameworkRiskLayer({ client });

  return createGroundworkLayer({
    policy,
    context,
    provenance,
    "risk": mutationRisk,
  });
};

export default GroundworkPlugin;
