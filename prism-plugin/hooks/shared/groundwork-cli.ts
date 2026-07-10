import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";

export type PortableHookResult =
  | { decision: "continue"; systemMessage?: string; additionalContext?: string }
  | { decision: "block"; message: string; systemMessage?: string };

export type HookEventName =
  | "session-start"
  | "prompt-submit"
  | "tool-before"
  | "tool-after"
  | "permission-request";

const resolveGroundworkBin = (): string => {
  const fromEnv = process.env.GROUNDWORK_BIN;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const home = process.env.HOME;
  if (home) {
    const candidate = path.join(home, ".local", "bin", "groundwork");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // fall through
    }
  }

  return "groundwork";
};

export const runGroundworkHook = async (
  event: HookEventName,
  payload: Record<string, unknown>,
): Promise<PortableHookResult> => {
  const bin = resolveGroundworkBin();
  const input = JSON.stringify(payload);
  const result = await spawnJson(bin, ["hook", event, input]);
  if (result.exitCode !== 0) {
    return {
      decision: "continue",
      systemMessage: `[groundwork] hook ${event} failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      ok?: boolean;
      data?: PortableHookResult;
      error?: { message?: string };
    };
    if (parsed.ok === false) {
      return {
        decision: "continue",
        systemMessage: `[groundwork] hook ${event} error: ${parsed.error?.message ?? result.stdout}`,
      };
    }
    if (parsed.data && typeof parsed.data === "object" && "decision" in parsed.data) {
      return parsed.data;
    }
    return {
      decision: "continue",
      systemMessage: `[groundwork] hook ${event} returned unexpected payload`,
    };
  } catch {
    return {
      decision: "continue",
      systemMessage: `[groundwork] hook ${event} returned non-JSON stdout`,
    };
  }
};

export const runGroundworkProvenance = async (
  cliName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
  const bin = resolveGroundworkBin();
  const input = JSON.stringify(args);
  const result = await spawnJson(bin, ["provenance", cliName, input]);
  if (result.exitCode !== 0) {
    return { ok: false, error: result.stderr || result.stdout || `exit ${result.exitCode}` };
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      ok?: boolean;
      data?: unknown;
      error?: { message?: string };
    };
    if (parsed.ok === false) {
      return { ok: false, error: parsed.error?.message ?? result.stdout };
    }
    return { ok: true, result: parsed.data };
  } catch {
    return { ok: false, error: "non-JSON provenance response" };
  }
};

const spawnJson = (
  command: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> =>
  new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });

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
