import { logger } from "../logger/index.ts";
import type { ToolDefinition } from "../provenance/tooling/tool.ts";

export const GROUNDWORK_HOOK_SURFACE = [
  "chat.message",
  "tool.execute.before",
  "tool.execute.after",
  "tool.definition",
  "event",
  "experimental.chat.system.transform",
  "experimental.session.compacting",
] as const;

export const GROUNDWORK_LAYER_ORDER = [
  "policy",
  "context",
  "provenance",
  "risk",
] as const;

export type GroundworkHookName = (typeof GROUNDWORK_HOOK_SURFACE)[number];
export type GroundworkLayerSlot = (typeof GROUNDWORK_LAYER_ORDER)[number];

export interface GroundworkToolDefinitionHookInput {
  toolID: string;
}

export interface GroundworkToolDefinitionHookOutput {
  description: string;
  parameters: unknown;
}

export type GroundworkToolDefinitionHook = (
  input: GroundworkToolDefinitionHookInput,
  output: GroundworkToolDefinitionHookOutput,
) => Promise<void>;

export type GroundworkHookResult = Promise<void>;
export type GroundworkToolDefinitions = Record<string, ToolDefinition>;

export interface GroundworkChatMessageHookInput {
  sessionID: string;
  [key: string]: unknown;
}

export interface GroundworkChatMessageHookOutput {
  parts: unknown;
  [key: string]: unknown;
}

export interface GroundworkToolExecuteHookInput {
  tool: string;
  callID: string;
  sessionID: string;
  [key: string]: unknown;
}

export interface GroundworkToolExecuteBeforeHookOutput {
  args: unknown;
  [key: string]: unknown;
}

export interface GroundworkToolExecuteAfterHookOutput {
  args?: unknown;
  result?: unknown;
  [key: string]: unknown;
}

export interface GroundworkEventHookInput {
  event: {
    type?: string;
    properties?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface GroundworkSystemTransformHookOutput {
  system: string[];
  [key: string]: unknown;
}

export interface GroundworkCompactionHookInput {
  sessionID: string;
  [key: string]: unknown;
}

export interface GroundworkCompactionHookOutput {
  context: string[];
  [key: string]: unknown;
}

export type GroundworkChatMessageHook = (
  input: GroundworkChatMessageHookInput,
  output: GroundworkChatMessageHookOutput,
) => GroundworkHookResult;

export type GroundworkToolExecuteBeforeHook = (
  input: GroundworkToolExecuteHookInput,
  output: GroundworkToolExecuteBeforeHookOutput,
) => GroundworkHookResult;

export type GroundworkToolExecuteAfterHook = (
  input: GroundworkToolExecuteHookInput,
  output: GroundworkToolExecuteAfterHookOutput,
) => GroundworkHookResult;

export type GroundworkEventHook = (input: GroundworkEventHookInput) => GroundworkHookResult;

export type GroundworkSystemTransformHook = (
  input: Record<string, unknown>,
  output: GroundworkSystemTransformHookOutput,
) => GroundworkHookResult;

export type GroundworkCompactionHook = (
  input: GroundworkCompactionHookInput,
  output: GroundworkCompactionHookOutput,
) => GroundworkHookResult;

export interface GroundworkDispatcher {
  tool: GroundworkToolDefinitions;
  "chat.message"?: GroundworkChatMessageHook;
  "tool.execute.before"?: GroundworkToolExecuteBeforeHook;
  "tool.execute.after"?: GroundworkToolExecuteAfterHook;
  "tool.definition": GroundworkToolDefinitionHook;
  event?: GroundworkEventHook;
  "experimental.chat.system.transform"?: GroundworkSystemTransformHook;
  "experimental.session.compacting"?: GroundworkCompactionHook;
}

export interface GroundworkLayerHooks {
  "chat.message"?: GroundworkChatMessageHook;
  "tool.execute.before"?: GroundworkToolExecuteBeforeHook;
  "tool.execute.after"?: GroundworkToolExecuteAfterHook;
  "tool.definition"?: GroundworkToolDefinitionHook;
  event?: GroundworkEventHook;
  "experimental.chat.system.transform"?: GroundworkSystemTransformHook;
  "experimental.session.compacting"?: GroundworkCompactionHook;
}

export interface GroundworkLayerRegistration {
  active?: boolean;
  hooks?: GroundworkLayerHooks;
  toolDefinitions?: GroundworkToolDefinitions;
}

export interface GroundworkLayerRegistry {
  policy?: GroundworkLayerRegistration | null;
  context?: GroundworkLayerRegistration | null;
  provenance?: GroundworkLayerRegistration | null;
  risk?: GroundworkLayerRegistration | null;
}

export interface MaterializedGroundworkLayer {
  slot: GroundworkLayerSlot;
  active: boolean;
  hooks: GroundworkLayerHooks;
  toolDefinitions: GroundworkToolDefinitions;
}

const EMPTY_LAYER_HOOKS = Object.freeze({}) as GroundworkLayerHooks;
const EMPTY_TOOL_DEFINITIONS = Object.freeze({}) as GroundworkToolDefinitions;

function hasEntries(value: object | null | undefined): boolean {
  return value !== undefined && value !== null && Object.keys(value).length > 0;
}

export function materializeGroundworkLayers(
  registry: GroundworkLayerRegistry = {},
): MaterializedGroundworkLayer[] {
  return GROUNDWORK_LAYER_ORDER.map((slot) => {
    const registration = registry[slot] ?? null;
    const hooks = registration?.hooks ?? EMPTY_LAYER_HOOKS;
    const toolDefinitions = registration?.toolDefinitions ?? EMPTY_TOOL_DEFINITIONS;

    return {
      slot,
      active: registration?.active ?? (hasEntries(hooks) || hasEntries(toolDefinitions)),
      hooks,
      toolDefinitions,
    };
  });
}

function mergeToolDefinitions(
  layers: readonly MaterializedGroundworkLayer[],
): GroundworkToolDefinitions {
  const toolDefinitions: GroundworkToolDefinitions = {};

  for (const layer of layers) {
    if (!layer.active) continue;
    Object.assign(toolDefinitions, layer.toolDefinitions);
  }

  return Object.freeze(toolDefinitions);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FrameworkEnforcementError extends Error {
  readonly source: string;
  readonly code?: string;

  constructor(options: { message: string; source: string; code?: string }) {
    super(options.message);
    this.name = "FrameworkEnforcementError";
    this.source = options.source;
    this.code = options.code;
  }
}

export function isFrameworkEnforcementError(error: unknown): error is FrameworkEnforcementError {
  return error instanceof FrameworkEnforcementError;
}

async function invokeLayerHook(options: {
  layer: MaterializedGroundworkLayer;
  hookName: GroundworkHookName;
  invoke: () => Promise<void>;
}): Promise<void> {
  try {
    await options.invoke();
  } catch (error) {
    if (isFrameworkEnforcementError(error)) {
      throw error;
    }

    logger.error("Framework hook dispatch failed", {
      layer: options.layer.slot,
      hook: options.hookName,
      error: toErrorMessage(error),
    });
  }
}

export function createGroundworkHookDispatcher(
  registry: GroundworkLayerRegistry = {},
): GroundworkDispatcher {
  const layers = materializeGroundworkLayers(registry);
  const dispatcher: GroundworkDispatcher = {
    tool: mergeToolDefinitions(layers),
    "chat.message": async (input, output) => {
      for (const layer of layers) {
        if (!layer.active) continue;
        await invokeLayerHook({
          layer,
          hookName: "chat.message",
          invoke: async () => {
            await layer.hooks["chat.message"]?.(input, output);
          },
        });
      }
    },
    "tool.execute.before": async (input, output) => {
      for (const layer of layers) {
        if (!layer.active) continue;
        await invokeLayerHook({
          layer,
          hookName: "tool.execute.before",
          invoke: async () => {
            await layer.hooks["tool.execute.before"]?.(input, output);
          },
        });
      }
    },
    "tool.execute.after": async (input, output) => {
      for (const layer of layers) {
        if (!layer.active) continue;
        await invokeLayerHook({
          layer,
          hookName: "tool.execute.after",
          invoke: async () => {
            await layer.hooks["tool.execute.after"]?.(input, output);
          },
        });
      }
    },
    "tool.definition": async (input, output) => {
      for (const layer of layers) {
        if (!layer.active) continue;
        await invokeLayerHook({
          layer,
          hookName: "tool.definition",
          invoke: async () => {
            await layer.hooks["tool.definition"]?.(input, output);
          },
        });
      }
    },
    event: async (input) => {
      for (const layer of layers) {
        if (!layer.active) continue;
        await invokeLayerHook({
          layer,
          hookName: "event",
          invoke: async () => {
            await layer.hooks.event?.(input);
          },
        });
      }
    },
    "experimental.chat.system.transform": async (input, output) => {
      for (const layer of layers) {
        if (!layer.active) continue;
        await invokeLayerHook({
          layer,
          hookName: "experimental.chat.system.transform",
          invoke: async () => {
            await layer.hooks["experimental.chat.system.transform"]?.(input, output);
          },
        });
      }
    },
    "experimental.session.compacting": async (input, output) => {
      for (const layer of layers) {
        if (!layer.active) continue;
        await invokeLayerHook({
          layer,
          hookName: "experimental.session.compacting",
          invoke: async () => {
            await layer.hooks["experimental.session.compacting"]?.(input, output);
          },
        });
      }
    },
  };

  return Object.freeze(dispatcher);
}
