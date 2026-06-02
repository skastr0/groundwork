import { type ToolDefinition } from "../tool.ts";
import {
  normalizeCreateStateToolsOptions,
  type CreateStateToolsOptions,
} from "../state/internal.ts";
import { createAuthorityTool } from "./authority.ts";
import { GW_AUTHORITY_TOOL, GW_HOTSPOTS_TOOL, GW_STABILITY_REPORT_TOOL } from "./constants.ts";
import { createHotspotsTool } from "./hotspots.ts";
import { createStabilityReportTool } from "./stability.ts";

export function createScoreTools(options: CreateStateToolsOptions): Record<string, ToolDefinition> {
  const runtimeOptions = normalizeCreateStateToolsOptions(options);

  return {
    [GW_HOTSPOTS_TOOL]: createHotspotsTool(runtimeOptions),
    [GW_AUTHORITY_TOOL]: createAuthorityTool(runtimeOptions),
    [GW_STABILITY_REPORT_TOOL]: createStabilityReportTool(runtimeOptions),
  };
}
