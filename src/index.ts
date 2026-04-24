import type { Plugin } from "@opencode-ai/plugin";
import { createSessionKernelStore } from "./kernel/index.ts";
import {
  createEpistemologyFrameworkLayer,
  EPISTEMOLOGY_FRAMEWORK_LAYER_META,
} from "./layer/index.ts";
import { initLogger, logger } from "./logger/index.ts";
import { createFrameworkMutationRiskLayer } from "./mutation-risk/index.ts";
import { createFrameworkPolicyLayer } from "./policy/index.ts";
import { createFrameworkProvenanceLayer } from "./provenance/index.ts";
import { createFrameworkWorldviewLayer } from "./worldview/index.ts";

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
  resolvePolicyConfigPath,
  resolveProjectPolicyConfigPath,
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
  createFrameworkMutationRiskLayer,
  createMutationRiskToolBeforeHook,
  evaluateBashCommand,
} from "./mutation-risk/index.ts";
export {
  createFrameworkWorldviewLayer,
  discoverFrameworkWorldviewFiles,
  FRAMEWORK_WORLDVIEW_INJECTION_MAX_BYTES,
  FRAMEWORK_WORLDVIEW_INJECTION_MAX_ITEMS,
  FRAMEWORK_WORLDVIEW_RULE_FILES,
} from "./worldview/index.ts";
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
  CreateFrameworkMutationRiskLayerOptions,
  GuardConfig,
  GuardDecision,
  GuardMode,
  GuardSeverity,
  GuardViolation,
} from "./mutation-risk/index.ts";
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
  CreateFrameworkWorldviewLayerOptions,
  DiscoverFrameworkWorldviewFilesOptions,
  FrameworkDiscoveredWorldviewFile,
  FrameworkWorldviewRuleFileName,
} from "./worldview/index.ts";
export { initLogger, logger } from "./logger/index.ts";
export {
  createEpistemologyFrameworkHookDispatcher,
  createEpistemologyFrameworkLayer,
  EPISTEMOLOGY_FRAMEWORK_HOOK_SURFACE,
  EPISTEMOLOGY_FRAMEWORK_LAYER_META,
  EPISTEMOLOGY_FRAMEWORK_LAYER_ORDER,
  EMPTY_EPISTEMOLOGY_FRAMEWORK_LAYER,
  FrameworkEnforcementError,
  isFrameworkEnforcementError,
  materializeEpistemologyFrameworkLayers,
} from "./layer/index.ts";
export type {
  EpistemologyFrameworkDispatcher,
  EpistemologyFrameworkHookName,
  EpistemologyFrameworkLayerHooks,
  EpistemologyFrameworkLayerRegistration,
  EpistemologyFrameworkLayerRegistry,
  EpistemologyFrameworkLayerSlot,
  EpistemologyFrameworkToolDefinitionHook,
  EpistemologyFrameworkToolDefinitionHookInput,
  EpistemologyFrameworkToolDefinitionHookOutput,
  EpistemologyFrameworkToolDefinitions,
  MaterializedEpistemologyFrameworkLayer,
} from "./layer/index.ts";

export const EpistemologyFrameworkPlugin: Plugin = async ({ $, client, directory, worktree }) => {
  initLogger(client);
  logger.info(
    "Epistemology framework composition root initialized",
    EPISTEMOLOGY_FRAMEWORK_LAYER_META,
  );

  const sessionStore = createSessionKernelStore();

  const policy = await createFrameworkPolicyLayer({
    client,
    directory,
    sessionStore,
    worktree,
  });
  const worldview = await createFrameworkWorldviewLayer({
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
  const mutationRisk = await createFrameworkMutationRiskLayer({ client });

  return createEpistemologyFrameworkLayer({
    policy,
    worldview,
    provenance,
    "mutation-risk": mutationRisk,
  });
};

export default EpistemologyFrameworkPlugin;
