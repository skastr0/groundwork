import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFrameworkHookHarness, createFrameworkMockClient } from "./framework-test-harness.ts";

const tempGlobals: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("framework policy runtime", () => {
  it("injects policy guidance with preserved session context", async () => {
    const harness = await createPolicyRuntimeHarness({
      policyToml: `version = 1

[[rules]]
id = "guidance"
match = ["src/**"]

[[rules.actions]]
type = "inject_prompt"
text = "load the right skill"
`,
    });

    try {
      await expect(
        harness.invokeToolBefore(
          {
            tool: "edit",
            callID: "call-guidance-1",
            sessionID: "session-guidance-1",
          },
          { filePath: "src/main.ts" },
        ),
      ).resolves.toBeUndefined();

      expect(harness.client.session.prompt).toHaveBeenCalledWith({
        path: { id: "session-guidance-1" },
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
              text: "[groundwork:policy] load the right skill",
              synthetic: false,
            },
          ],
        },
      });
      expect(harness.client.session.messages).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("locks mutating tools until explicit /policy override", async () => {
    const harness = await createPolicyRuntimeHarness({
      policyToml: `version = 1

[[rules]]
id = "human-override-required"
match = ["infra/prod/**"]

[[rules.actions]]
type = "require_human_override"
`,
    });

    try {
      await expect(
        harness.invokeToolBefore(
          { tool: "edit", callID: "call-1", sessionID: "session-1" },
          { filePath: "infra/prod/main.tf" },
        ),
      ).rejects.toThrow("requires explicit human override");

      await expect(
        harness.invokeToolBefore(
          { tool: "write", callID: "call-2", sessionID: "session-1" },
          { filePath: "README.md" },
        ),
      ).rejects.toThrow("Mutating tools are locked");

      await harness.invokeChatMessage(
        { sessionID: "session-1" },
        { parts: [{ type: "text", text: "/policy override human-reviewed" }] },
      );

      await expect(
        harness.invokeToolBefore(
          { tool: "write", callID: "call-3", sessionID: "session-1" },
          { filePath: "README.md" },
        ),
      ).resolves.toBeUndefined();

      expect(harness.client.session.prompt).toHaveBeenLastCalledWith({
        path: { id: "session-1" },
        body: expect.objectContaining({
          parts: [
            {
              type: "text",
              text: "[groundwork:policy] Override accepted: human-reviewed",
              synthetic: false,
            },
          ],
        }),
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("cleans policy session locks on session deletion events", async () => {
    const harness = await createPolicyRuntimeHarness({
      policyToml: `version = 1

[[rules]]
id = "human-override-required"
match = ["infra/prod/**"]

[[rules.actions]]
type = "require_human_override"
`,
    });

    try {
      await expect(
        harness.invokeToolBefore(
          { tool: "edit", callID: "call-1", sessionID: "session-cleanup-1" },
          { filePath: "infra/prod/main.tf" },
        ),
      ).rejects.toThrow("requires explicit human override");

      await expect(
        harness.invokeToolBefore(
          { tool: "write", callID: "call-2", sessionID: "session-cleanup-1" },
          { filePath: "README.md" },
        ),
      ).rejects.toThrow("Mutating tools are locked");

      await harness.cleanupSession("session-cleanup-1");

      await expect(
        harness.invokeToolBefore(
          { tool: "write", callID: "call-3", sessionID: "session-cleanup-1" },
          { filePath: "README.md" },
        ),
      ).resolves.toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });

  it("enforces ensure_skill_loaded in block mode until confirmation", async () => {
    const harness = await createPolicyRuntimeHarness({
      policyToml: `version = 1

[[rules]]
id = "skill-gate"
match = ["plugin/**"]

[[rules.actions]]
type = "ensure_skill_loaded"
skills = ["release-readiness", "groundwork"]
mode = "block"
`,
    });

    try {
      await expect(
        harness.invokeToolBefore(
          { tool: "edit", callID: "call-1", sessionID: "session-1" },
          { filePath: "plugin/foo.ts" },
        ),
      ).rejects.toThrow("Required skills missing");

      await harness.invokeChatMessage(
        { sessionID: "session-1" },
        {
          parts: [
            {
              type: "text",
              text: "/policy skill-loaded release-readiness groundwork",
            },
          ],
        },
      );

      await expect(
        harness.invokeToolBefore(
          { tool: "edit", callID: "call-2", sessionID: "session-1" },
          { filePath: "plugin/foo.ts" },
        ),
      ).resolves.toBeUndefined();
    } finally {
      await harness.cleanup();
    }
  });

  it("blocks tool execution without writing filesystem policy artifacts", async () => {
    const harness = await createPolicyRuntimeHarness({
      policyToml: `version = 1

[[rules]]
id = "block-src"
match = ["src/**"]

[[rules.actions]]
type = "block_tool"
message = "blocked by policy"
`,
    });

    try {
      await expect(
        harness.invokeToolBefore(
          { tool: "edit", callID: "call-1", sessionID: "session-1" },
          { filePath: "src/main.ts" },
        ),
      ).rejects.toThrow("blocked by policy");

      await expect(fs.readdir(harness.rootDir)).resolves.not.toContain("policy-messages");
    } finally {
      await harness.cleanup();
    }
  });

  it("terminates the session on stop_session actions", async () => {
    const harness = await createPolicyRuntimeHarness({
      policyToml: `version = 1

[[rules]]
id = "critical-stop"
match = ["apps/backend/auth/**"]

[[rules.actions]]
type = "stop_session"
message = "critical violation"
`,
    });

    try {
      await expect(
        harness.invokeToolBefore(
          { tool: "edit", callID: "call-1", sessionID: "session-1" },
          { filePath: "apps/backend/auth/routes.ts" },
        ),
      ).rejects.toThrow("critical violation");

      expect(harness.client.session.abort).toHaveBeenCalledTimes(1);

      await expect(
        harness.invokeToolBefore(
          { tool: "edit", callID: "call-2", sessionID: "session-1" },
          { filePath: "README.md" },
        ),
      ).rejects.toThrow("Session is terminated");
    } finally {
      await harness.cleanup();
    }
  });
});

async function createPolicyRuntimeHarness(options: {
  policyToml?: string;
  sessionMessages?: NonNullable<Parameters<typeof createFrameworkMockClient>[0]>["sessionMessages"];
}) {
  const { GroundworkPlugin } = await import("../index.ts");
  const globalConfig = path.join(
    os.tmpdir(),
    `groundwork-global-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`,
  );
  tempGlobals.push(globalConfig);

  return createFrameworkHookHarness({
    clientOptions: {
      sessionMessages: options.sessionMessages,
    },
    createHooks: async (context) => {
      if (options.policyToml) {
        await writePolicy(context.directory, options.policyToml);
      }

      const previousGlobalConfig = process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG;
      process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG = globalConfig;

      try {
        return await GroundworkPlugin(context);
      } finally {
        if (previousGlobalConfig === undefined) {
          delete process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG;
        } else {
          process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG = previousGlobalConfig;
        }
      }
    },
  });
}

async function writePolicy(root: string, policyToml: string): Promise<void> {
  const policyPath = path.join(root, "groundwork.toml");
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, policyToml, "utf8");
}
