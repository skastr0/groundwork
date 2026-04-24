import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameworkHookHarness } from "./framework-test-harness.ts";

type TestClient = {
  app: {
    log: (entry: unknown) => Promise<void>;
  };
  session: {
    messages: (entry: unknown) => Promise<{
      data: Array<{
        info?: {
          agent?: string;
          model?: { providerID: string; modelID: string };
          system?: string;
          tools?: Record<string, unknown>;
          variant?: string;
        };
      }>;
    }>;
    prompt: (entry: unknown) => Promise<void>;
  };
};

describe("framework test harness", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("supports session context, prompt injection, logging, and cleanup hooks", async () => {
    const cleanedSessions: string[] = [];
    const harness = await createFrameworkHookHarness({
      createHooks: ({ client }) => {
        const testClient = client as unknown as TestClient;

        return {
          "tool.execute.before": async (input) => {
            const messages = await testClient.session.messages({
              path: { id: input.sessionID },
            });
            const info = messages.data[0]?.info;
            await testClient.session.prompt({
              path: { id: input.sessionID },
              body: {
                agent: info?.agent,
                model: info?.model,
                noReply: true,
                system: info?.system,
                tools: info?.tools,
                variant: info?.variant,
                parts: [
                  {
                    type: "text",
                    text: `[framework] ${input.tool}`,
                    synthetic: false,
                  },
                ],
              },
            });
            await testClient.app.log({
              body: {
                service: "framework-test",
                level: "info",
                message: "before hook",
                extra: { callID: input.callID, tool: input.tool },
              },
            });
          },
          event: async ({ event }) => {
            if (event.type !== "session.deleted") {
              return;
            }

            const sessionID = String((event.properties as { sessionID?: unknown }).sessionID ?? "");
            cleanedSessions.push(sessionID);
            await testClient.app.log({
              body: {
                service: "framework-test",
                level: "info",
                message: "cleanup hook",
                extra: { sessionID },
              },
            });
          },
        };
      },
    });

    try {
      await harness.invokeToolBefore(
        {
          tool: "edit",
          callID: "call-1",
          sessionID: "session-1",
        },
        { filePath: "plugin/example.ts" },
      );
      await harness.cleanupSession("session-1");

      expect(harness.client.session.messages).toHaveBeenCalledWith({
        path: { id: "session-1" },
      });
      expect(harness.client.session.prompt).toHaveBeenCalledWith({
        path: { id: "session-1" },
        body: {
          agent: "builder",
          model: { providerID: "openai", modelID: "gpt-5.4" },
          noReply: true,
          system: "preserve system prompt",
          tools: { edit: true, read: true },
          variant: "careful",
          parts: [
            {
              type: "text",
              text: "[framework] edit",
              synthetic: false,
            },
          ],
        },
      });
      expect(cleanedSessions).toEqual(["session-1"]);
      expect(harness.client.app.log).toHaveBeenCalledTimes(2);
    } finally {
      await harness.cleanup();
    }
  });
});
