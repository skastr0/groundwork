import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const CODEX_HOOK_ENTRY = path.resolve(process.cwd(), "packages", "codex", "src", "hook.ts");

async function runCodexHook(
  stdin: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  const proc = spawn(process.execPath, [CODEX_HOOK_ENTRY], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
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
  proc.stdin.end(stdin);

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });

  return { exitCode, stdout, stderr };
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

describe("Groundwork Codex hook package", () => {
  it("emits SessionStart context", async () => {
    const result = await runCodexHook(
      JSON.stringify({
        hook_event_name: "SessionStart",
        cwd: process.cwd(),
        session_id: "session-start",
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining("Groundwork Codex plugin is active"),
      },
    });
  });

  it("blocks risky Bash commands once, then warns and reports execution", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-risk-"));

    try {
      const first = await runCodexHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd: rootDir,
          session_id: "risk-hook-session",
          tool_name: "Bash",
          tool_use_id: "risk-hook-call-1",
          tool_input: { command: "git reset --hard" },
        }),
      );

      expect(first.exitCode).toBe(0);
      expect(parseJson(first.stdout)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: expect.stringContaining("Blocked once for this exact command"),
        },
      });

      const second = await runCodexHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd: rootDir,
          session_id: "risk-hook-session",
          tool_name: "Bash",
          tool_use_id: "risk-hook-call-2",
          tool_input: { command: "git reset --hard" },
        }),
      );

      expect(second.exitCode).toBe(0);
      expect(parseJson(second.stdout)).toMatchObject({
        systemMessage: expect.stringContaining("Proceeding after a prior block-once warning"),
      });

      const post = await runCodexHook(
        JSON.stringify({
          hook_event_name: "PostToolUse",
          cwd: rootDir,
          session_id: "risk-hook-session",
          tool_name: "Bash",
          tool_use_id: "risk-hook-call-2",
          tool_input: { command: "git reset --hard" },
        }),
      );

      expect(post.exitCode).toBe(0);
      const parsedPost = parseJson(post.stdout) as {
        systemMessage?: string;
        hookSpecificOutput?: { additionalContext?: string };
      };
      const additionalContext = parsedPost.hookSpecificOutput?.additionalContext;
      expect(parsedPost.systemMessage).toContain(
        "Unsafe command executed after prior block-once warning",
      );
      expect(parsedPost).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
        },
      });
      expect(additionalContext).toContain("risk feedback");
      expect(additionalContext).not.toContain("context reminders");
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("warns only for repeated risky Bash permission requests", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-permission-"));

    try {
      const first = await runCodexHook(
        JSON.stringify({
          hook_event_name: "PermissionRequest",
          cwd: rootDir,
          session_id: "permission-risk-session",
          tool_name: "Bash",
          tool_use_id: "permission-risk-call-1",
          tool_input: { command: "git reset --hard" },
        }),
      );

      expect(first.exitCode).toBe(0);
      expect(parseJson(first.stdout)).toMatchObject({
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
          decision: {
            behavior: "deny",
            message: expect.stringContaining("Blocked once for this exact command"),
          },
        },
      });

      const second = await runCodexHook(
        JSON.stringify({
          hook_event_name: "PermissionRequest",
          cwd: rootDir,
          session_id: "permission-risk-session",
          tool_name: "Bash",
          tool_use_id: "permission-risk-call-2",
          tool_input: { command: "git reset --hard" },
        }),
      );

      expect(second.exitCode).toBe(0);
      const parsed = parseJson(second.stdout) as {
        systemMessage?: string;
        hookSpecificOutput?: { decision?: unknown };
      };
      expect(parsed).toMatchObject({
        systemMessage: expect.stringContaining("Proceeding after a prior block-once warning"),
        hookSpecificOutput: {
          hookEventName: "PermissionRequest",
        },
      });
      expect(parsed.hookSpecificOutput?.decision).toBeUndefined();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("denies risky Bash commands without session state", async () => {
    const result = await runCodexHook(
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git reset --hard" },
      }),
    );

    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("block-once retry state could not be recorded"),
      },
    });
  });

  it("reports inherited context for touched paths", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-context-"));
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "AGENTS.md"), "Use package context guidance.\n", "utf8");

    const payload = {
      hook_event_name: "PostToolUse",
      cwd: rootDir,
      session_id: "context-session",
      tool_name: "apply_patch",
      tool_use_id: "context-call",
      tool_input: {
        patchText:
          "*** Begin Patch\n*** Add File: src/feature/main.ts\n+export {}\n*** End Patch\n",
      },
    };

    const first = await runCodexHook(JSON.stringify(payload));
    expect(first.exitCode).toBe(0);
    expect(parseJson(first.stdout)).toMatchObject({
      systemMessage: expect.stringContaining("Use package context guidance."),
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
      },
    });

    const second = await runCodexHook(
      JSON.stringify({ ...payload, tool_use_id: "context-call-2" }),
    );
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe("");
  });

  it("loads local policy packs during hooks without Git on PATH", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-policy-pack-"));
    const emptyPath = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-empty-path-"));

    try {
      await fs.mkdir(path.join(rootDir, ".groundwork", "plugins"), { recursive: true });
      await fs.writeFile(
        path.join(rootDir, "groundwork.toml"),
        `version = 1
plugins = ["groundwork-effect"]
`,
        "utf8",
      );
      await fs.writeFile(
        path.join(rootDir, ".groundwork", "plugins", "groundwork-effect.toml"),
        `version = 1

[[rules]]
id = "hook-local-policy-pack"
severity = "warn"
match = ["src/**"]

[[rules.actions]]
type = "block_tool"
message = "hook loaded local policy pack"
`,
        "utf8",
      );

      const result = await runCodexHook(
        JSON.stringify({
          hook_event_name: "PreToolUse",
          cwd: rootDir,
          session_id: "hook-local-pack-session",
          tool_name: "apply_patch",
          tool_use_id: "hook-local-pack-call",
          tool_input: {
            patchText:
              "*** Begin Patch\n*** Add File: src/index.ts\n+export {}\n*** End Patch\n",
          },
        }),
        { env: { PATH: emptyPath } },
      );

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(parseJson(result.stdout)).toMatchObject({
        systemMessage: expect.stringContaining("hook loaded local policy pack"),
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
      await fs.rm(emptyPath, { recursive: true, force: true });
    }
  });

  it("returns JSON feedback for invalid hook payloads", async () => {
    const result = await runCodexHook("{");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      systemMessage: expect.stringContaining("invalid Codex hook JSON"),
    });
  });
});
