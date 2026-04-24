import type { OpencodeClient } from "@opencode-ai/sdk";

// Logger that uses OpenCode's built-in logging via SDK client
// Logs go to ~/.local/share/opencode/log/ alongside other opencode logs

let client: OpencodeClient | null = null;
const SERVICE_NAME = "review";

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
    // Silently ignore logging failures
  }
}

export const log = (message: string): void => {
  void logToOpencode("info", message);
};

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

export const createRequestLogger = (requestId: string, toolName: string) => {
  const extra = { requestId, tool: toolName };

  return {
    log: (message: string): void => {
      void logToOpencode("debug", message, extra);
    },
    start: (query: string): void => {
      void logToOpencode("info", "Starting request", { ...extra, query });
    },
    error: (error: unknown): void => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      void logToOpencode("error", errorMessage, {
        ...extra,
        stack: error instanceof Error ? error.stack : undefined,
      });
    },
    complete: (): void => {
      void logToOpencode("info", "Request completed", extra);
    },
  };
};
