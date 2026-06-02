import { z } from "zod";

export type ToolExecute<TArgs = any> = (
  args: TArgs,
  context?: unknown,
) => string | Promise<string>;

export interface ToolDefinition<TArgs = any> {
  description: string;
  args?: Record<string, unknown>;
  execute: ToolExecute<TArgs>;
}

function defineTool<TDefinition extends ToolDefinition<any>>(
  definition: TDefinition,
): TDefinition {
  return definition;
}

export const tool = Object.assign(defineTool, {
  schema: z,
});
