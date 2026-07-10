import { defineHook, hookEvent, hookTool } from "prism";
import {
  callIdFromEvent,
  rootFromEvent,
  runGroundworkHook,
  sessionIdFromEvent,
  toolInputFromEvent,
  toolNameFromEvent,
} from "./shared/groundwork-cli.ts";

export default defineHook({
  name: "tool-before",
  description: "Pre-tool Groundwork risk (block-once shell) and policy evaluation.",
  event: hookEvent.toolBefore,
  match: { tool: hookTool.any() },
  async handle(event) {
    const result = await runGroundworkHook("tool-before", {
      root_dir: rootFromEvent(event),
      session_id: sessionIdFromEvent(event),
      call_id: callIdFromEvent(event),
      tool_name: toolNameFromEvent(event),
      args: toolInputFromEvent(event),
    });
    if (result.decision === "block") {
      return {
        decision: "block" as const,
        message: result.message,
        systemMessage: result.systemMessage,
      };
    }
    return {
      decision: "continue" as const,
      systemMessage: result.systemMessage,
      additionalContext: result.additionalContext,
    };
  },
});
