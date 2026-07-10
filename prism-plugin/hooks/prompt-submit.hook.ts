import { defineHook, hookEvent } from "prism";
import {
  rootFromEvent,
  runPortableHook,
  sessionIdFromEvent,
} from "./shared/groundwork-runtime.ts";

export default defineHook({
  name: "prompt-submit",
  description: "Record /policy override and /policy skill-loaded into durable session state.",
  targets: ["codex-cli", "opencode", "claude-code", "kimi-code"],
  event: hookEvent.promptSubmit,
  async handle(event) {
    const result = await runPortableHook("prompt-submit", {
      root_dir: rootFromEvent(event),
      session_id: sessionIdFromEvent(event),
      prompt: typeof event.prompt === "string" ? event.prompt : "",
    });
    return {
      decision: "continue" as const,
      systemMessage: result.systemMessage,
      additionalContext: result.decision === "continue" ? result.additionalContext : undefined,
    };
  },
});
