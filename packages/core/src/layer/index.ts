import {
  createGroundworkHookDispatcher,
  GROUNDWORK_HOOK_SURFACE,
  GROUNDWORK_LAYER_ORDER,
  type GroundworkLayerRegistry,
} from "./dispatcher.ts";

export const GROUNDWORK_LAYER_META = {
  pluginId: "groundwork",
  packageId: "@skastr0/groundwork-core",
  runtimeSurfaces: ["cli", "codex", "opencode"] as const,
  hookSurface: GROUNDWORK_HOOK_SURFACE,
  // Ordering is intentional: policy can block or inject before any prompt/context work,
  // context adds inherited instructions before provenance hints are rendered, provenance
  // enriches the default tool path, and risk stays last as the final destructive stop.
  layerOrder: GROUNDWORK_LAYER_ORDER,
} as const;

export const EMPTY_GROUNDWORK_LAYER = createGroundworkHookDispatcher();

export function createGroundworkLayer(
  registry: GroundworkLayerRegistry = {},
) {
  if (Object.keys(registry).length === 0) {
    return EMPTY_GROUNDWORK_LAYER;
  }

  return createGroundworkHookDispatcher(registry);
}
