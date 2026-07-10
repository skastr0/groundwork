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
  name: "tool-after",
  description: "Post-tool Groundwork policy/risk/context feedback (non-blocking).",
  event: hookEvent.toolAfter,
  match: { tool: hookTool.any() },
  async handle(event) {
    const callId = callIdFromEvent(event);
    if (!callId) return { decision: "continue" as const };
    const result = await runGroundworkHook("tool-after", {
      root_dir: rootFromEvent(event),
      session_id: sessionIdFromEvent(event),
      call_id: callId,
      tool_name: toolNameFromEvent(event),
      args: toolInputFromEvent(event),
    });
    return {
      decision: "continue" as const,
      systemMessage: result.systemMessage,
      additionalContext: result.decision === "continue" ? result.additionalContext : undefined,
    };
  },
});
