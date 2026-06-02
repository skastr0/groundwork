import type { SessionKernelStore } from "../kernel/state.ts";
import type { GroundworkLayerHooks } from "./dispatcher.ts";

export function createFrameworkSessionCleanupEventHook(
  sessionStore: Pick<SessionKernelStore, "cleanup">,
): NonNullable<GroundworkLayerHooks["event"]> {
  return async ({ event }) => {
    if (event.type !== "session.deleted") {
      return;
    }

    const sessionID = readFrameworkEventSessionID(event.properties);
    if (!sessionID) {
      return;
    }

    sessionStore.cleanup(sessionID);
  };
}

function readFrameworkEventSessionID(properties: unknown): string | null {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return null;
  }

  const values = properties as Record<string, unknown>;
  const id = values["id"];
  if (typeof id === "string" && id.length > 0) {
    return id;
  }

  const sessionID = values["sessionID"];
  return typeof sessionID === "string" && sessionID.length > 0 ? sessionID : null;
}
