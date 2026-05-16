import { createProvenanceFailure } from "./contracts.ts";

export function createUnsupportedModeFailure(toolName: `gw_${string}`, mode: string): string {
  return JSON.stringify(
    createProvenanceFailure({
      tool: toolName,
      mode: mode as "remote" | "hybrid",
      confidence: "unknown",
      ambiguity: "high",
      summary: `Unsupported provenance mode '${mode}' for ${toolName}.`,
      error: {
        code: "MODE_NOT_SUPPORTED",
        message: `${toolName} currently supports only local mode.`,
      },
    }),
    null,
    2,
  );
}
