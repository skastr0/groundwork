import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEpistemologyFrameworkLayer } from "../index.ts";
import { createFrameworkMutationRiskLayer } from "../mutation-risk/index.ts";
import { createFrameworkHookHarness } from "./framework-test-harness.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("framework mutation-risk layer", () => {
  it("blocks destructive bash commands through the framework plugin without standalone activation", async () => {
    const { EpistemologyFrameworkPlugin } = await import("../index.ts");
    const previousGlobalConfig = process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG;
    process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG = path.join(
      os.tmpdir(),
      "epistemology-framework.global.none.toml",
    );

    const harness = await createFrameworkHookHarness({ plugin: EpistemologyFrameworkPlugin });

    try {
      await expect(
        harness.invokeToolBefore(
          {
            tool: "bash",
            callID: "call-bash-1",
            sessionID: "session-bash-1",
          },
          { command: "git checkout -- README.md" },
        ),
      ).rejects.toThrow(
        "[epistemology-framework:mutation-risk] git checkout -- discards local file changes (rule: git.checkout-discard)",
      );

      expect(harness.client.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            service: "epistemology-framework-mutation-risk",
            level: "warn",
            message: "Blocked potentially destructive command",
            extra: expect.objectContaining({
              mode: "block",
              ruleId: "git.checkout-discard",
            }),
          }),
        }),
      );
    } finally {
      if (previousGlobalConfig === undefined) {
        delete process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG;
      } else {
        process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG = previousGlobalConfig;
      }
      await harness.cleanup();
    }
  });

  it("preserves warn mode behavior under the framework layer", async () => {
    const harness = await createFrameworkHookHarness({
      createHooks: async (context) =>
        createEpistemologyFrameworkLayer({
          "mutation-risk": await createFrameworkMutationRiskLayer({
            client: context.client,
            env: {
              OPENCODE_DESTRUCTIVE_GUARD_MODE: "warn",
            },
          }),
        }),
    });

    try {
      await expect(
        harness.invokeToolBefore(
          {
            tool: "bash",
            callID: "call-bash-2",
            sessionID: "session-bash-2",
          },
          { command: "rm -rf ./src" },
        ),
      ).resolves.toBeUndefined();

      expect(harness.client.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            service: "epistemology-framework-mutation-risk",
            level: "warn",
            message: "Blocked potentially destructive command",
            extra: expect.objectContaining({
              mode: "warn",
              ruleId: "rm.recursive-force",
            }),
          }),
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });
});
