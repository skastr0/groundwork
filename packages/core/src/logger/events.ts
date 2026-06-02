import type { FrameworkLogClient, FrameworkLogLevel } from "./index.ts";

export async function logFrameworkEvent(
  client: FrameworkLogClient,
  service: string,
  level: FrameworkLogLevel,
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service,
        level,
        message,
        extra,
      },
    });
  } catch {
    // Keep logging failures from affecting plugin behavior.
  }
}
