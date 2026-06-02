import type { ToolDefinition } from "../tool.ts";
import {
  createFileStateTool,
  GW_FILE_STATE_TOOL,
} from "./file-tool.ts";
import {
  createRepoStateTool,
  GW_REPO_STATE_TOOL,
} from "./repo-tool.ts";
import {
  normalizeCreateStateToolsOptions,
  type CreateStateToolsOptions,
} from "./tool-options.ts";

export function createStateTools(options: CreateStateToolsOptions): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [GW_REPO_STATE_TOOL]: createRepoStateTool(runtimeOptions),
    [GW_FILE_STATE_TOOL]: createFileStateTool(runtimeOptions),
  };
}
