import type { PluginInput } from "@opencode-ai/plugin";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeRuntimeLayers } from "./compose-runtime-layers.ts";
import { createFrameworkHookHarness } from "./framework-test-harness.ts";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");

  return {
    tool: Object.assign((input: unknown) => input, { schema: z }),
  };
});

describe("Groundwork layer composition", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the core helper inert while portable layers compose runtime hooks", async () => {
    const {
      GROUNDWORK_LAYER_META,
      createGroundworkLayer,
    } = await import("../../packages/core/src/index.ts");
    const { EMPTY_GROUNDWORK_LAYER } = await import("../../packages/core/src/layer/index.ts");
    const { GROUNDWORK_HOOK_SURFACE, GROUNDWORK_LAYER_ORDER } =
      await import("../../packages/core/src/layer/dispatcher.ts");
    const { FRAMEWORK_PROVENANCE_TOOL_IDS } = await import("../../packages/core/src/provenance/registry.ts");
    const previousGlobalConfig = process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG;
    process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG = path.join(
      os.tmpdir(),
      "groundwork.global.none.toml",
    );

    const harness = await createFrameworkHookHarness({
      createHooks: async (context) => composeRuntimeLayers(context),
      shell: createUnexpectedShell(),
    });

    try {
      expect(GROUNDWORK_LAYER_META).toEqual({
        pluginId: "groundwork",
        packageId: "@skastr0/groundwork-core",
        runtimeSurfaces: ["cli", "prism"],
        hookSurface: GROUNDWORK_HOOK_SURFACE,
        layerOrder: GROUNDWORK_LAYER_ORDER,
      });
      expect(createGroundworkLayer()).toBe(EMPTY_GROUNDWORK_LAYER);
      expect(Object.isFrozen(EMPTY_GROUNDWORK_LAYER)).toBe(true);
      expect(Object.keys(harness.hooks.tool ?? {})).toEqual(FRAMEWORK_PROVENANCE_TOOL_IDS);
      expect(typeof harness.hooks["chat.message"]).toBe("function");
      expect(typeof harness.hooks["tool.execute.before"]).toBe("function");
      expect(typeof harness.hooks["tool.execute.after"]).toBe("function");
      expect(typeof Reflect.get(harness.hooks, "tool.definition")).toBe("function");
      expect(typeof harness.hooks.event).toBe("function");
      expect(typeof harness.hooks["experimental.chat.system.transform"]).toBe("function");
      expect(typeof harness.hooks["experimental.session.compacting"]).toBe("function");
      expect(harness.hooks).not.toBe(EMPTY_GROUNDWORK_LAYER);
    } finally {
      if (previousGlobalConfig === undefined) {
        delete process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG;
      } else {
        process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG = previousGlobalConfig;
      }
      await harness.cleanup();
    }
  });

  it("routes blocked edit, apply_patch, and bash checks through the unified framework hooks", async () => {
    const harness = await createFrameworkPluginHarness({
      policyToml: `version = 1

[[rules]]
id = "block-src-edit"
match = ["src/**"]
tools_include = ["edit"]

[[rules.actions]]
type = "block_tool"
message = "edit blocked by policy"

[[rules]]
id = "block-src-apply-patch"
match = ["src/**"]
tools_include = ["apply_patch"]
scope = "changed_lines"

[[rules.content]]
type = "ast_grep"
language = "ts"
pattern = "console.log($ARG)"

[[rules.actions]]
type = "block_tool"
message = "patch blocked by policy"
`,
    });
    const targetPath = path.join(harness.rootDir, "src", "main.ts");

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, "const safe = 1;\n", "utf8");

    try {
      await expect(
        harness.invokeToolBefore(
          {
            tool: "edit",
            callID: "call-edit-1",
            sessionID: "session-edit-1",
          },
          { filePath: "src/main.ts" },
        ),
      ).rejects.toThrow("edit blocked by policy");

      await expect(
        harness.invokeToolBefore(
          {
            tool: "bash",
            callID: "call-bash-1",
            sessionID: "session-bash-1",
          },
          { command: "git checkout -- src/main.ts" },
        ),
      ).rejects.toThrow(
        `[groundwork:risk] git checkout -- discards local file changes (rule: git.checkout-discard)`,
      );

      const patchText = `*** Begin Patch
*** Update File: src/main.ts
@@
-const safe = 1;
+console.log("boom");
*** End Patch`;

      await expect(
        harness.invokeToolBefore(
          {
            tool: "apply_patch",
            callID: "call-patch-1",
            sessionID: "session-patch-1",
          },
          { patchText },
        ),
      ).resolves.toBeUndefined();

      await fs.writeFile(targetPath, 'console.log("boom");\n', "utf8");

      await expect(
        harness.invokeToolAfter({
          tool: "apply_patch",
          callID: "call-patch-1",
          sessionID: "session-patch-1",
        }),
      ).rejects.toThrow("patch blocked by policy");
    } finally {
      await harness.cleanup();
    }
  });

  it("exposes portable hook decisions without harness plugins", async () => {
    const { toolBeforeResult, sessionStartResult } = await import(
      "../../packages/core/src/portable/index.ts"
    );
    expect(sessionStartResult({}).additionalContext).toContain("Groundwork is active");
    const blocked = await toolBeforeResult({
      toolName: "Bash",
      args: { command: "git push --force origin main" },
    });
    expect(blocked.decision).toBe("block");
  });
});

async function createFrameworkPluginHarness(options: { policyToml?: string } = {}) {
  const globalConfig = path.join(
    os.tmpdir(),
    `groundwork-global-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`,
  );

  return createFrameworkHookHarness({
    createHooks: async (context) => {
      if (options.policyToml) {
        await writePolicy(context.directory, options.policyToml);
      }

      const previousGlobalConfig = process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG;
      process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG = globalConfig;

      try {
        return await composeRuntimeLayers(context);
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

function createUnexpectedShell(): PluginInput["$"] {
  function shell(..._args: Parameters<PluginInput["$"]>): ReturnType<PluginInput["$"]> {
    throw new Error("framework provenance shell stub should not execute in tests");
  }

  shell.braces = (pattern: string) => [pattern];
  shell.escape = (input: string) => input;
  shell.env = () => shell;
  shell.cwd = () => shell;
  shell.nothrow = () => shell;
  shell.throws = () => shell;

  return shell;
}
