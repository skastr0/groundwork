import { describe, expect, it, vi } from "vitest";
import {
  resolveSessionPromptContext,
  toSessionPromptContext,
} from "../../packages/core/src/kernel/prompt-context.ts";

describe("session prompt context resolver", () => {
  it("selects the first user message and preserves prompt context safely", async () => {
    const firstUserTools: Record<string, boolean> = {
      read: true,
      edit: true,
    };
    const firstUserModel = {
      providerID: "openai",
      modelID: "gpt-5.4",
    };
    const readMessages = vi.fn(async () => ({
      data: [
        {
          info: {
            role: "assistant",
            agent: "ignored",
            model: { providerID: "anthropic", modelID: "claude" },
            system: "ignore this system",
            tools: { bash: true },
            variant: "fast",
          },
        },
        {
          info: {
            messageID: "message-1",
            role: "user",
            agent: "builder",
            model: firstUserModel,
            system: "preserve this system prompt",
            tools: firstUserTools,
            variant: "careful",
          },
        },
        {
          info: {
            messageID: "message-2",
            role: "user",
            agent: "coder",
            model: { providerID: "openai", modelID: "gpt-4.1" },
            system: "ignore the later user prompt",
            tools: { bash: true },
            variant: "fast",
          },
        },
      ],
    }));

    const promptContext = await resolveSessionPromptContext(
      {
        session: {
          messages: readMessages,
        },
      },
      "session-1",
    );

    firstUserTools.read = false;
    firstUserModel.modelID = "mutated-model";

    expect(readMessages).toHaveBeenCalledWith({
      path: { id: "session-1" },
      query: { limit: 10 },
    });
    expect(promptContext).toEqual({
      messageID: "message-1",
      role: "user",
      agent: "builder",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      system: "preserve this system prompt",
      tools: {
        read: true,
        edit: true,
      },
      variant: "careful",
    });
  });

  it("returns null when the first user message lacks required context", async () => {
    const promptContext = await resolveSessionPromptContext(
      {
        session: {
          messages: async () => ({
            data: [
              {
                info: {
                  messageID: "message-1",
                  role: "user",
                  system: "missing required fields",
                  tools: { read: true },
                  variant: "careful",
                },
              },
              {
                info: {
                  messageID: "message-2",
                  role: "user",
                  agent: "builder",
                  model: { providerID: "openai", modelID: "gpt-5.4" },
                  system: "complete but intentionally ignored",
                  tools: { read: true },
                  variant: "careful",
                },
              },
            ],
          }),
        },
      },
      "session-2",
    );

    expect(promptContext).toBeNull();
  });

  it("degrades safely when session message loading is unavailable", async () => {
    const promptContext = await resolveSessionPromptContext(
      {
        session: {},
      },
      "session-3",
    );

    expect(promptContext).toBeNull();
  });

  it("serializes session prompt context while filtering non-boolean tools", () => {
    expect(
      toSessionPromptContext({
        messageID: "message-1",
        role: "user",
        agent: "builder",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        system: "preserve system prompt",
        variant: "careful",
        tools: {
          edit: true,
          read: false,
          nested: { enabled: true },
          label: "enabled",
          unset: undefined,
        },
      }),
    ).toEqual({
      messageID: "message-1",
      agent: "builder",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      system: "preserve system prompt",
      variant: "careful",
      tools: {
        edit: true,
        read: false,
      },
    });
  });
});
