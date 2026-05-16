import type { ToolDefinition } from "@opencode-ai/plugin";
import {
  normalizeCreateStateToolsOptions,
  type CreateStateToolsOptions,
} from "../state/index.ts";
import { createBlockReadTool } from "./block-read-tool.ts";
import { createReadTool } from "./read-tool.ts";
import { GW_BLOCK_READ_TOOL, GW_READ_TOOL } from "./schemas.ts";

export {
  ProvBlockReadDataSchema,
  ProvBlockReadResultSchema,
  ProvReadDataSchema,
  ProvReadResultSchema,
} from "./schemas.ts";
export type {
  ProvBlockReadData,
  ProvBlockReadResult,
  ProvReadData,
  ProvReadResult,
} from "./schemas.ts";

export function createQueryTools(options: CreateStateToolsOptions): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [GW_READ_TOOL]: createReadTool(runtimeOptions),
    [GW_BLOCK_READ_TOOL]: createBlockReadTool(runtimeOptions),
  };
}
