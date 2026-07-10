import { defineHook, hookEvent } from "prism";
import {
  rootFromEvent,
  runPortableHook,
  sessionIdFromEvent,
} from "./shared/groundwork-runtime.ts";

export default defineHook({
  name: "session-start",
  description: "Inject Groundwork session guidance (durable policy/risk/context foundations).",
  event: hookEvent.sessionStart,
  async handle(event) {
    const result = await runPortableHook("session-start", {
      root_dir: rootFromEvent(event),
      session_id: sessionIdFromEvent(event),
    });
    return {
      decision: "continue" as const,
      systemMessage: result.systemMessage,
      additionalContext: result.decision === "continue" ? result.additionalContext : undefined,
    };
  },
});
