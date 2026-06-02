import type { ToolDefinition } from "../tool.ts";
import {
  normalizeCreateStateToolsOptions,
  type CreateStateToolsOptions,
} from "../state/internal.ts";
import { createBlockReadTool } from "./block-read-tool.ts";
import { createReadTool } from "./read-tool.ts";
import { GW_BLOCK_READ_TOOL, GW_READ_TOOL } from "./schemas.ts";

export function createQueryTools(options: CreateStateToolsOptions): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [GW_READ_TOOL]: createReadTool(runtimeOptions),
    [GW_BLOCK_READ_TOOL]: createBlockReadTool(runtimeOptions),
  };
}
