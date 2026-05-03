import type { Event } from "@opencode-ai/sdk";
import { describe, expect, it } from "vitest";
import type { GroundworkToolDefinitions } from "../index.ts";
import {
  createGroundworkLayer,
  GROUNDWORK_LAYER_ORDER,
  FrameworkEnforcementError,
  materializeGroundworkLayers,
} from "../index.ts";
import { createFrameworkHookHarness } from "./framework-test-harness.ts";

function createTestToolDefinitions(name: string): GroundworkToolDefinitions {
  return {
    [name]: {
      description: `${name} test tool`,
    },
  } as unknown as GroundworkToolDefinitions;
}

describe("framework hook dispatcher", () => {
  it("dispatches active layer hooks and tool definitions in explicit framework order", async () => {
    const seen: string[] = [];
    const hooks = createGroundworkLayer({
      provenance: {
        active: true,
        toolDefinitions: createTestToolDefinitions("provenance-tool"),
        hooks: {
          "chat.message": async () => {
            seen.push("provenance:chat");
          },
          "tool.execute.before": async () => {
            seen.push("provenance:before");
          },
          "tool.execute.after": async () => {
            seen.push("provenance:after");
          },
          "tool.definition": async (_input, output) => {
            seen.push("provenance:tool-definition");
            output.description = `${output.description} provenance`;
          },
          event: async () => {
            seen.push("provenance:event");
          },
          "experimental.chat.system.transform": async (_input, output) => {
            seen.push("provenance:system");
            output.system.push("provenance");
          },
          "experimental.session.compacting": async (_input, output) => {
            seen.push("provenance:compaction");
            output.context.push("provenance");
          },
        },
      },
      policy: {
        active: true,
        toolDefinitions: createTestToolDefinitions("policy-tool"),
        hooks: {
          "chat.message": async () => {
            seen.push("policy:chat");
          },
          "tool.execute.before": async () => {
            seen.push("policy:before");
          },
          "tool.execute.after": async () => {
            seen.push("policy:after");
          },
          "tool.definition": async (_input, output) => {
            seen.push("policy:tool-definition");
            output.description = `${output.description} policy`;
          },
          event: async () => {
            seen.push("policy:event");
          },
          "experimental.chat.system.transform": async (_input, output) => {
            seen.push("policy:system");
            output.system.push("policy");
          },
          "experimental.session.compacting": async (_input, output) => {
            seen.push("policy:compaction");
            output.context.push("policy");
          },
        },
      },
      context: {
        active: true,
        toolDefinitions: createTestToolDefinitions("context-tool"),
        hooks: {
          "chat.message": async () => {
            seen.push("context:chat");
          },
          "tool.execute.before": async () => {
            seen.push("context:before");
          },
          "tool.execute.after": async () => {
            seen.push("context:after");
          },
          "tool.definition": async (_input, output) => {
            seen.push("context:tool-definition");
            output.description = `${output.description} context`;
          },
          event: async () => {
            seen.push("context:event");
          },
          "experimental.chat.system.transform": async (_input, output) => {
            seen.push("context:system");
            output.system.push("context");
          },
          "experimental.session.compacting": async (_input, output) => {
            seen.push("context:compaction");
            output.context.push("context");
          },
        },
      },
    });
    const harness = await createFrameworkHookHarness({ hooks });

    try {
      expect(
        materializeGroundworkLayers({
          context: { active: true },
          policy: { active: true },
        }).map((layer) => layer.slot),
      ).toEqual(GROUNDWORK_LAYER_ORDER);
      expect(Object.keys(hooks.tool ?? {})).toEqual([
        "policy-tool",
        "context-tool",
        "provenance-tool",
      ]);

      await harness.invokeChatMessage(
        {
          sessionID: "session-1",
        },
        {
          parts: [{ type: "text", text: "/policy override reviewed" }],
        },
      );
      await harness.invokeToolBefore(
        {
          tool: "edit_file",
          callID: "call-1",
          sessionID: "session-1",
        },
        { filePath: "plugin/example.ts" },
      );
      await harness.invokeToolAfter({
        tool: "edit_file",
        callID: "call-1",
        sessionID: "session-1",
      });
      await harness.emitEvent({
        type: "session.idle",
        properties: { sessionID: "session-1" },
      } as unknown as Event);

      const systemOutput = { system: [] as string[] };
      await harness.invokeHook(
        "experimental.chat.system.transform",
        {
          sessionID: "session-1",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        },
        systemOutput,
      );

      const compactionOutput = { context: [] as string[] };
      await harness.invokeHook(
        "experimental.session.compacting",
        { sessionID: "session-1" },
        compactionOutput,
      );

      const toolDefinitionOutput = {
        description: "read tool",
        parameters: { type: "object" },
      };
      await hooks["tool.definition"]({ toolID: "read" }, toolDefinitionOutput);

      expect(seen).toEqual([
        "policy:chat",
        "context:chat",
        "provenance:chat",
        "policy:before",
        "context:before",
        "provenance:before",
        "policy:after",
        "context:after",
        "provenance:after",
        "policy:event",
        "context:event",
        "provenance:event",
        "policy:system",
        "context:system",
        "provenance:system",
        "policy:compaction",
        "context:compaction",
        "provenance:compaction",
        "policy:tool-definition",
        "context:tool-definition",
        "provenance:tool-definition",
      ]);
      expect(systemOutput.system).toEqual(["policy", "context", "provenance"]);
      expect(compactionOutput.context).toEqual(["policy", "context", "provenance"]);
      expect(toolDefinitionOutput.description).toBe("read tool policy context provenance");
      expect(toolDefinitionOutput.parameters).toEqual({ type: "object" });
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps inactive and no-op layers safe across the dispatcher hook surface", async () => {
    const seen: string[] = [];
    const hooks = createGroundworkLayer({
      policy: {
        active: true,
      },
      context: {
        active: false,
        toolDefinitions: createTestToolDefinitions("context-tool"),
        hooks: {
          "chat.message": async () => {
            seen.push("context:chat");
          },
          event: async () => {
            seen.push("context:event");
          },
          "experimental.chat.system.transform": async (_input, output) => {
            seen.push("context:system");
            output.system.push("context");
          },
        },
      },
    });
    const harness = await createFrameworkHookHarness({ hooks });

    try {
      await harness.invokeChatMessage(
        {
          sessionID: "session-2",
        },
        {
          parts: [{ type: "text", text: "/policy override reviewed" }],
        },
      );
      await harness.invokeToolBefore(
        {
          tool: "read",
          callID: "call-2",
          sessionID: "session-2",
        },
        { filePath: "plugin/example.ts" },
      );
      await harness.invokeToolAfter({
        tool: "read",
        callID: "call-2",
        sessionID: "session-2",
      });
      await harness.emitEvent({
        type: "session.deleted",
        properties: { sessionID: "session-2" },
      } as unknown as Event);

      const systemOutput = { system: [] as string[] };
      await harness.invokeHook(
        "experimental.chat.system.transform",
        {
          sessionID: "session-2",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        },
        systemOutput,
      );

      const compactionOutput = { context: [] as string[] };
      await harness.invokeHook(
        "experimental.session.compacting",
        { sessionID: "session-2" },
        compactionOutput,
      );

      const toolDefinitionOutput = {
        description: "read tool",
        parameters: { type: "object" },
      };
      await hooks["tool.definition"]({ toolID: "read" }, toolDefinitionOutput);

      expect(seen).toEqual([]);
      expect(hooks.tool).toEqual({});
      expect(systemOutput.system).toEqual([]);
      expect(compactionOutput.context).toEqual([]);
      expect(toolDefinitionOutput).toEqual({
        description: "read tool",
        parameters: { type: "object" },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("swallows unexpected layer hook failures and continues dispatching later layers", async () => {
    const seen: string[] = [];
    const hooks = createGroundworkLayer({
      policy: {
        active: true,
        hooks: {
          "tool.execute.before": async () => {
            seen.push("policy:before");
            throw new Error("policy before hook failed");
          },
        },
      },
      context: {
        active: true,
        hooks: {
          "tool.execute.before": async () => {
            seen.push("context:before");
          },
        },
      },
    });
    const harness = await createFrameworkHookHarness({ hooks });

    try {
      await harness.invokeToolBefore(
        {
          tool: "read",
          callID: "call-guard-1",
          sessionID: "session-guard-1",
        },
        { filePath: "plugin/example.ts" },
      );

      expect(seen).toEqual(["policy:before", "context:before"]);
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves intentional enforcement failures and stops later layers", async () => {
    const seen: string[] = [];
    const hooks = createGroundworkLayer({
      policy: {
        active: true,
        hooks: {
          "tool.execute.before": async () => {
            seen.push("policy:before");
            throw new FrameworkEnforcementError({
              message: "blocked by framework policy",
              source: "groundwork-policy",
              code: "block_tool",
            });
          },
        },
      },
      context: {
        active: true,
        hooks: {
          "tool.execute.before": async () => {
            seen.push("context:before");
          },
        },
      },
    });
    const harness = await createFrameworkHookHarness({ hooks });

    try {
      await expect(
        harness.invokeToolBefore(
          {
            tool: "edit",
            callID: "call-guard-2",
            sessionID: "session-guard-2",
          },
          { filePath: "plugin/example.ts" },
        ),
      ).rejects.toThrow("blocked by framework policy");

      expect(seen).toEqual(["policy:before"]);
    } finally {
      await harness.cleanup();
    }
  });
});
