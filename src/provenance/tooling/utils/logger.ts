import type { OpencodeClient } from "@opencode-ai/sdk";

let client: OpencodeClient | null = null;
const SERVICE_NAME = "groundwork-provenance";

export function initLogger(sdkClient: OpencodeClient): void {
  client = sdkClient;
}

async function logToOpencode(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  if (!client) return;

  try {
    await client.app.log({
      body: {
        service: SERVICE_NAME,
        level,
        message,
        extra,
      },
    });
  } catch {
    // Keep logging failures from affecting tool behavior.
  }
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>): void => {
    void logToOpencode("debug", message, extra);
  },
  info: (message: string, extra?: Record<string, unknown>): void => {
    void logToOpencode("info", message, extra);
  },
  warn: (message: string, extra?: Record<string, unknown>): void => {
    void logToOpencode("warn", message, extra);
  },
  error: (message: string, extra?: Record<string, unknown>): void => {
    void logToOpencode("error", message, extra);
  },
};
