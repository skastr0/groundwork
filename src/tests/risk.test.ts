import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroundworkLayer } from "../../packages/core/src/index.ts";
import { createFrameworkRiskLayer } from "../../packages/core/src/risk/index.ts";
import { createFrameworkHookHarness } from "./framework-test-harness.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runGroundwork(args: string[]): Promise<CommandResult> {
  const proc = spawn("bun", ["./src/cli.ts", ...args], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  proc.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });

  return { exitCode, stdout, stderr };
}

describe("framework risk layer", () => {
  it("blocks destructive bash commands through the framework plugin without standalone activation", async () => {
    const { GroundworkPlugin } = await import("../../packages/opencode-plugin/src/index.ts");
    const previousGlobalConfig = process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG;
    process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG = path.join(
      os.tmpdir(),
      "groundwork.global.none.toml",
    );

    const harness = await createFrameworkHookHarness({ plugin: GroundworkPlugin });

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
        "[groundwork:risk] git checkout -- discards local file changes (rule: git.checkout-discard)",
      );

      expect(harness.client.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            service: "groundwork-risk",
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
        delete process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG;
      } else {
        process.env.GROUNDWORK_POLICY_GLOBAL_CONFIG = previousGlobalConfig;
      }
      await harness.cleanup();
    }
  });

  it("preserves warn mode behavior under the framework layer", async () => {
    const harness = await createFrameworkHookHarness({
      createHooks: async (context) =>
        createGroundworkLayer({
          "risk": await createFrameworkRiskLayer({
            client: context.client,
            env: {
              GROUNDWORK_DESTRUCTIVE_GUARD_MODE: "warn",
            },
          }),
        }) as never,
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
            service: "groundwork-risk",
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

  it("keeps OpenCode risk hook decisions compatible with the CLI risk command", async () => {
    const command = "git reset --hard";
    const cliResult = await runGroundwork([
      "risk",
      "evaluate-command",
      JSON.stringify({ command }),
    ]);
    expect(cliResult.exitCode).toBe(0);
    expect(cliResult.stderr).toBe("");
    const cliEnvelope = JSON.parse(cliResult.stdout) as {
      data: {
        decision: string;
        violation: { ruleId: string; reason: string };
      };
    };
    expect(cliEnvelope.data).toMatchObject({
      decision: "block",
      violation: {
        ruleId: "git.reset-hard",
      },
    });

    const harness = await createFrameworkHookHarness({
      createHooks: async (context) =>
        createGroundworkLayer({
          "risk": await createFrameworkRiskLayer({
            client: context.client,
            env: {
              GROUNDWORK_DESTRUCTIVE_GUARD_MODE: "block",
            },
          }),
        }) as never,
    });

    try {
      await expect(
        harness.invokeToolBefore(
          {
            tool: "bash",
            callID: "call-bash-compatible",
            sessionID: "session-bash-compatible",
          },
          { command },
        ),
      ).rejects.toThrow(
        `[groundwork:risk] ${cliEnvelope.data.violation.reason} (rule: ${cliEnvelope.data.violation.ruleId})`,
      );

      expect(harness.client.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            service: "groundwork-risk",
            level: "warn",
            extra: expect.objectContaining({
              mode: "block",
              ruleId: cliEnvelope.data.violation.ruleId,
            }),
          }),
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("keeps OpenCode and CLI risk modes compatible for warn and off", async () => {
    const warnCliResult = await runGroundwork([
      "risk",
      "evaluate-command",
      JSON.stringify({
        command: "git reset --hard",
        config: { mode: "warn" },
      }),
    ]);
    expect(warnCliResult.exitCode).toBe(0);
    const warnCliEnvelope = JSON.parse(warnCliResult.stdout) as {
      data: { decision: string; violation: { ruleId: string } };
    };
    expect(warnCliEnvelope.data).toMatchObject({
      decision: "warn",
      violation: {
        ruleId: "git.reset-hard",
      },
    });

    const warnHarness = await createFrameworkHookHarness({
      createHooks: async (context) =>
        createGroundworkLayer({
          "risk": await createFrameworkRiskLayer({
            client: context.client,
            env: {
              GROUNDWORK_DESTRUCTIVE_GUARD_MODE: "warn",
            },
          }),
        }) as never,
    });

    try {
      await expect(
        warnHarness.invokeToolBefore(
          {
            tool: "bash",
            callID: "call-bash-warn-compatible",
            sessionID: "session-bash-warn-compatible",
          },
          { command: "git reset --hard" },
        ),
      ).resolves.toBeUndefined();

      expect(warnHarness.client.app.log).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            service: "groundwork-risk",
            level: "warn",
            extra: expect.objectContaining({
              mode: "warn",
              ruleId: warnCliEnvelope.data.violation.ruleId,
            }),
          }),
        }),
      );
    } finally {
      await warnHarness.cleanup();
    }

    const offCliResult = await runGroundwork([
      "risk",
      "evaluate-command",
      JSON.stringify({
        command: "git reset --hard",
        config: { mode: "off" },
      }),
    ]);
    expect(offCliResult.exitCode).toBe(0);
    expect(JSON.parse(offCliResult.stdout)).toMatchObject({
      data: {
        decision: "allow",
        violation: null,
      },
    });

    const offHarness = await createFrameworkHookHarness({
      createHooks: async (context) =>
        createGroundworkLayer({
          "risk": await createFrameworkRiskLayer({
            client: context.client,
            env: {
              GROUNDWORK_DESTRUCTIVE_GUARD_MODE: "off",
            },
          }),
        }) as never,
    });

    try {
      await expect(
        offHarness.invokeToolBefore(
          {
            tool: "bash",
            callID: "call-bash-off-compatible",
            sessionID: "session-bash-off-compatible",
          },
          { command: "git reset --hard" },
        ),
      ).resolves.toBeUndefined();

      expect(offHarness.client.app.log).not.toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            service: "groundwork-risk",
            level: "warn",
          }),
        }),
      );
    } finally {
      await offHarness.cleanup();
    }
  });
});
