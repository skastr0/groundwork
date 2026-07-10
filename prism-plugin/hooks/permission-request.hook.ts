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
  name: "permission-request",
  description: "Groundwork risk gate on permission requests (shell/Bash).",
  targets: ["codex-cli", "opencode"],
  event: hookEvent.permissionRequest,
  match: { tool: hookTool.any() },
  async handle(event) {
    const result = await runGroundworkHook("permission-request", {
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
