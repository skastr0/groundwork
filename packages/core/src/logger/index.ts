export type FrameworkLogLevel = "debug" | "info" | "warn" | "error";

export type FrameworkLogClient = {
  app: {
    log(input: {
      body: {
        service: string;
        level: FrameworkLogLevel;
        message: string;
        extra?: Record<string, unknown>;
      };
    }): Promise<unknown> | unknown;
  };
};

let client: FrameworkLogClient | null = null;
const SERVICE_NAME = "groundwork";

export function initLogger(sdkClient: FrameworkLogClient): void {
  client = sdkClient;
}

async function logToOpencode(
  level: FrameworkLogLevel,
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
    // Keep logging failures from affecting plugin behavior.
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
