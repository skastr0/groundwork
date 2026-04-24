import {
  createEpistemologyFrameworkHookDispatcher,
  EPISTEMOLOGY_FRAMEWORK_HOOK_SURFACE,
  EPISTEMOLOGY_FRAMEWORK_LAYER_ORDER,
  type EpistemologyFrameworkLayerRegistry,
} from "./dispatcher.ts";

export {
  createEpistemologyFrameworkHookDispatcher,
  EPISTEMOLOGY_FRAMEWORK_HOOK_SURFACE,
  EPISTEMOLOGY_FRAMEWORK_LAYER_ORDER,
  FrameworkEnforcementError,
  isFrameworkEnforcementError,
  materializeEpistemologyFrameworkLayers,
} from "./dispatcher.ts";
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
} from "./dispatcher.ts";

export const EPISTEMOLOGY_FRAMEWORK_LAYER_META = {
  pluginId: "epistemology-framework",
  activeDiscoveryBarrel: true,
  migrationStatus: "single-home",
  hookSurface: EPISTEMOLOGY_FRAMEWORK_HOOK_SURFACE,
  // Ordering is intentional: policy can block or inject before any prompt/context work,
  // worldview adds inherited instructions before provenance hints are rendered, provenance
  // enriches the default tool path, and mutation-risk stays last as the final destructive stop.
  layerOrder: EPISTEMOLOGY_FRAMEWORK_LAYER_ORDER,
} as const;

export const EMPTY_EPISTEMOLOGY_FRAMEWORK_LAYER = createEpistemologyFrameworkHookDispatcher();

export function createEpistemologyFrameworkLayer(
  registry: EpistemologyFrameworkLayerRegistry = {},
) {
  if (Object.keys(registry).length === 0) {
    return EMPTY_EPISTEMOLOGY_FRAMEWORK_LAYER;
  }

  return createEpistemologyFrameworkHookDispatcher(registry);
}
