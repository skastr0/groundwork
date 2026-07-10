import { defineHook, hookEvent } from "prism";
import { rootFromEvent, runGroundworkHook, sessionIdFromEvent } from "./shared/groundwork-cli.ts";

export default defineHook({
  name: "prompt-submit",
  description: "Record /policy override and /policy skill-loaded commands into durable session state.",
  targets: ["codex-cli", "opencode", "kimi-code"],
  event: hookEvent.promptSubmit,
  async handle(event) {
    const result = await runGroundworkHook("prompt-submit", {
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
