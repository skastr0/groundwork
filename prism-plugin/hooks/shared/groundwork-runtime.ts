/**
 * In-plugin re-export of the Groundwork plugin SDK.
 *
 * Source of truth: @skastr0/groundwork-core/plugin-sdk
 * At package time, scripts/bundle-plugin-sdk.ts freezes a self-contained copy
 * into prism-plugin/lib/plugin-sdk.mjs so Prism can copy the plugin tree into a
 * temp dir and bun-bundle hooks without needing the Groundwork CLI or external
 * node_modules.
 *
 * Prefer the frozen lib when present (production package path); fall back to the
 * monorepo package for local authoring/typecheck.
 */
import {
  permissionRequestResult,
  promptSubmitResult,
  sessionStartResult,
  toolAfterResult,
  toolBeforeResult,
  runProvenanceTool,
  type FrameworkProvenanceToolID,
  type PortableHookResult,
} from "../../lib/plugin-sdk.generated.ts";

export {
  permissionRequestResult,
  promptSubmitResult,
  sessionStartResult,
  toolAfterResult,
  toolBeforeResult,
  runProvenanceTool,
};

export type { FrameworkProvenanceToolID, PortableHookResult };

export type HookEventName =
  | "session-start"
  | "prompt-submit"
  | "tool-before"
  | "tool-after"
  | "permission-request";

export const runPortableHook = async (
  event: HookEventName,
  payload: Record<string, unknown>,
): Promise<PortableHookResult> => {
  const rootDir =
    typeof payload.root_dir === "string" ? payload.root_dir : undefined;
  const sessionId =
    typeof payload.session_id === "string" ? payload.session_id : undefined;
  const callId = typeof payload.call_id === "string" ? payload.call_id : undefined;
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : undefined;
  const args =
    payload.args && typeof payload.args === "object" && !Array.isArray(payload.args)
      ? (payload.args as Record<string, unknown>)
      : undefined;

  switch (event) {
    case "session-start":
      return sessionStartResult({ rootDir, sessionId });
    case "prompt-submit":
      return promptSubmitResult({
        rootDir,
        sessionId,
        prompt: typeof payload.prompt === "string" ? payload.prompt : "",
      });
    case "tool-before":
      return toolBeforeResult({
        rootDir,
        sessionId,
        callId,
        toolName: toolName ?? "unknown",
        args,
      });
    case "tool-after":
      if (!callId) return { decision: "continue" };
      return toolAfterResult({
        rootDir,
        sessionId,
        callId,
        toolName,
        args,
      });
    case "permission-request":
      return permissionRequestResult({
        rootDir,
        sessionId,
        callId,
        toolName,
        args,
      });
  }
};

export const runGwTool = async (
  tool: FrameworkProvenanceToolID,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> => {
  try {
    const result = await runProvenanceTool({
      tool,
      root_dir: typeof args.root_dir === "string" ? args.root_dir : process.cwd(),
      args,
    });
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const rootFromEvent = (event: {
  cwd?: string;
  session?: { id?: string; cwd?: string };
}): string | undefined => {
  if (typeof event.cwd === "string" && event.cwd.length > 0) return event.cwd;
  const sessionCwd = event.session?.cwd;
  if (typeof sessionCwd === "string" && sessionCwd.length > 0) return sessionCwd;
  return undefined;
};

export const sessionIdFromEvent = (event: {
  session?: { id?: string };
}): string | undefined => {
  const id = event.session?.id;
  return typeof id === "string" && id.length > 0 ? id : undefined;
};

export const toolNameFromEvent = (event: {
  tool?: { nativeName?: string; logical?: string; name?: string };
}): string => event.tool?.nativeName ?? event.tool?.logical ?? event.tool?.name ?? "unknown";

export const toolInputFromEvent = (event: {
  tool?: { input?: unknown };
}): Record<string, unknown> | undefined => {
  const input = event.tool?.input;
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
};

export const callIdFromEvent = (event: {
  tool?: { callId?: string; id?: string; toolUseId?: string };
  native?: unknown;
}): string | undefined => {
  const fromTool = event.tool?.callId ?? event.tool?.id ?? event.tool?.toolUseId;
  if (typeof fromTool === "string" && fromTool.length > 0) return fromTool;
  if (event.native && typeof event.native === "object") {
    const native = event.native as Record<string, unknown>;
    for (const key of ["tool_use_id", "toolUseId", "call_id", "callID", "id"]) {
      const value = native[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }
  return undefined;
};
