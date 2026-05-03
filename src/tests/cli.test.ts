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

async function runGroundwork(args: string[], stdin?: string): Promise<CommandResult> {
  const proc = spawn("bun", ["./src/cli.ts", ...args], {
    cwd: process.cwd(),
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
  if (stdin !== undefined) {
    proc.stdin.end(stdin);
  } else {
    proc.stdin.end();
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });

  return { exitCode, stdout, stderr };
}

async function runGroundworkWithEnv(
  args: string[],
  stdin: string,
  env: NodeJS.ProcessEnv,
): Promise<CommandResult> {
  const proc = spawn("bun", ["./src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
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

function expectJsonOnlyFailure(result: CommandResult) {
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr.trim()).toMatch(/^\{/);
  expect(() => parseJson(result.stderr)).not.toThrow();
}

describe("groundwork CLI", () => {
  it("prints deterministic JSON doctor output", async () => {
    const result = await runGroundwork(["doctor"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "doctor",
      data: {
        cli: { name: "groundwork" },
        status: "ok",
      },
    });
  });

  it("prints deterministic JSON capabilities", async () => {
    const result = await runGroundwork(["capabilities"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "capabilities",
      data: {
        cli: { name: "groundwork" },
        protocol_version: "groundwork-cli/v1",
      },
    });
  });

  it("reports Codex integration readiness", async () => {
    const result = await runGroundwork(["codex", "doctor"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "codex doctor",
      data: {
        integration: "codex",
        status: "ok",
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "plugin.manifest", ok: true }),
          expect.objectContaining({ name: "plugin.skill.groundwork", ok: true }),
          expect.objectContaining({ name: "plugin.hooks", ok: true }),
        ]),
      },
    });
  });

  it("installs project-local Codex hooks and skill files", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-project-"));
    const result = await runGroundwork([
      "codex",
      "install-project",
      JSON.stringify({ target_dir: targetDir }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "codex install-project",
      data: {
        target_dir: targetDir,
        files: expect.arrayContaining([
          expect.objectContaining({ action: "created" }),
        ]),
      },
    });

    await expect(fs.readFile(path.join(targetDir, ".codex", "config.toml"), "utf8")).resolves.toContain(
      "codex_hooks = true",
    );
    await expect(fs.readFile(path.join(targetDir, ".codex", "hooks.json"), "utf8")).resolves.toContain(
      "groundwork codex hook",
    );
    const hooksConfig = JSON.parse(await fs.readFile(path.join(targetDir, ".codex", "hooks.json"), "utf8"));
    expect(Object.keys(hooksConfig.hooks).sort()).toEqual([
      "PermissionRequest",
      "PostToolUse",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
    await expect(
      fs.readFile(path.join(targetDir, ".codex", "skills", "groundwork", "SKILL.md"), "utf8"),
    ).resolves.toContain("name: groundwork");
  });

  it("installs project-local Codex hooks with an explicit hook command", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-command-"));
    const hookCommand = "/opt/groundwork/bin/groundwork codex hook";
    const result = await runGroundwork([
      "codex",
      "install-project",
      JSON.stringify({ target_dir: targetDir, hook_command: hookCommand }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "codex install-project",
      data: {
        hook_command: hookCommand,
      },
    });
    await expect(fs.readFile(path.join(targetDir, ".codex", "hooks.json"), "utf8")).resolves.toContain(
      hookCommand,
    );
  });

  it("patches existing project Codex config without replacing unrelated settings", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-existing-"));
    const codexDir = path.join(targetDir, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(
      path.join(codexDir, "config.toml"),
      ['model = "gpt-5.5"', "", "[features]", "shell_snapshot = true", ""].join("\n"),
      "utf8",
    );
    await fs.writeFile(path.join(codexDir, "hooks.json"), '{"existing":true}\n', "utf8");

    const result = await runGroundwork([
      "codex",
      "install-project",
      JSON.stringify({ target_dir: targetDir }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "codex install-project",
      data: {
        files: expect.arrayContaining([
          expect.objectContaining({
            path: path.join(codexDir, "config.toml"),
            action: "patched",
          }),
          expect.objectContaining({
            path: path.join(codexDir, "hooks.json"),
            action: "skipped",
          }),
        ]),
      },
    });

    const config = await fs.readFile(path.join(codexDir, "config.toml"), "utf8");
    expect(config).toContain('model = "gpt-5.5"');
    expect(config).toContain("shell_snapshot = true");
    expect(config).toContain("codex_hooks = true");
    await expect(fs.readFile(path.join(codexDir, "hooks.json"), "utf8")).resolves.toBe(
      '{"existing":true}\n',
    );
  });

  it("force overwrites project hook files without replacing config", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-force-"));
    const codexDir = path.join(targetDir, ".codex");
    await fs.mkdir(codexDir, { recursive: true });
    await fs.writeFile(path.join(codexDir, "config.toml"), 'model = "gpt-5.5"\n', "utf8");
    await fs.writeFile(path.join(codexDir, "hooks.json"), '{"existing":true}\n', "utf8");

    const result = await runGroundwork([
      "codex",
      "install-project",
      JSON.stringify({ target_dir: targetDir, force: true }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "codex install-project",
      data: {
        files: expect.arrayContaining([
          expect.objectContaining({
            path: path.join(codexDir, "config.toml"),
            action: "patched",
          }),
          expect.objectContaining({
            path: path.join(codexDir, "hooks.json"),
            action: "overwritten",
          }),
        ]),
      },
    });

    const config = await fs.readFile(path.join(codexDir, "config.toml"), "utf8");
    expect(config).toContain('model = "gpt-5.5"');
    expect(config).toContain("codex_hooks = true");
    await expect(fs.readFile(path.join(codexDir, "hooks.json"), "utf8")).resolves.toContain(
      "groundwork codex hook",
    );
  });

  it("installs user-level Codex hooks and skill files", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-home-"));
    const result = await runGroundwork([
      "codex",
      "install-user",
      JSON.stringify({ codex_home: codexHome }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "codex install-user",
      data: {
        codex_home: codexHome,
      },
    });

    await expect(fs.readFile(path.join(codexHome, "hooks.json"), "utf8")).resolves.toContain(
      "groundwork codex hook",
    );
    await expect(fs.readFile(path.join(codexHome, "config.toml"), "utf8")).resolves.toContain(
      "codex_hooks = true",
    );
    await expect(
      fs.readFile(path.join(codexHome, "skills", "groundwork", "SKILL.md"), "utf8"),
    ).resolves.toContain("name: groundwork");
  });

  it("installs user-level Codex hooks with an explicit hook command", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-home-command-"));
    const hookCommand = "/opt/groundwork/bin/groundwork codex hook";
    const result = await runGroundwork([
      "codex",
      "install-user",
      JSON.stringify({ codex_home: codexHome, hook_command: hookCommand }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "codex install-user",
      data: {
        hook_command: hookCommand,
      },
    });
    await expect(fs.readFile(path.join(codexHome, "hooks.json"), "utf8")).resolves.toContain(
      hookCommand,
    );
  });

  it("emits Codex SessionStart hook context", async () => {
    const result = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "SessionStart",
        source: "startup",
        cwd: process.cwd(),
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: expect.stringContaining("Groundwork is available"),
      },
    });
  });

  it("denies risky Bash commands from Codex PreToolUse hooks", async () => {
    const result = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: "git reset --hard",
        },
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("[groundwork:risk]"),
      },
    });
  });

  it("reports but does not deny risky Bash commands from Codex hooks in warn mode", async () => {
    const result = await runGroundworkWithEnv(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: "git reset --hard",
        },
      }),
      { OPENCODE_DESTRUCTIVE_GUARD_MODE: "warn" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      systemMessage: expect.stringContaining("Warn mode matched git.reset-hard"),
    });
  });

  it("does not deny risky Bash commands from Codex hooks in off mode", async () => {
    const result = await runGroundworkWithEnv(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: {
          command: "git reset --hard",
        },
      }),
      { OPENCODE_DESTRUCTIVE_GUARD_MODE: "off" },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("");
  });

  it("ignores unsupported Codex PreToolUse hooks without policy config", async () => {
    const result = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "apply_patch",
        tool_input: {
          command: "git reset --hard",
        },
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("denies policy violations from Codex PreToolUse hooks", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-policy-"));
    await fs.mkdir(path.join(rootDir, ".opencode"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, ".opencode", "policy.toml"),
      `version = 1

[[rules]]
id = "block-src"
match = ["src/**"]

[[rules.actions]]
type = "block_tool"
message = "src edits require review"
`,
      "utf8",
    );

    const result = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "codex-policy-session",
        cwd: rootDir,
        tool_name: "apply_patch",
        tool_use_id: "codex-call-1",
        tool_input: {
          command: "patch",
          patchText: "*** Begin Patch\n*** Update File: src/index.ts\n@@\n+x\n*** End Patch\n",
        },
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("src edits require review"),
      },
    });
  });

  it("still applies policy denial when Bash risk is warn-only", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-risk-policy-"));
    await fs.mkdir(path.join(rootDir, ".opencode"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, ".opencode", "policy.toml"),
      `version = 1

[[rules]]
id = "block-any-bash"
match = ["blocked.txt"]
tools_include = ["bash"]

[[rules.actions]]
type = "block_tool"
message = "bash command blocked by policy"
`,
      "utf8",
    );

    const result = await runGroundworkWithEnv(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "risk-policy-session",
        cwd: rootDir,
        tool_name: "Bash",
        tool_use_id: "risk-policy-call",
        tool_input: {
          command: "git reset --hard",
          path: "blocked.txt",
        },
      }),
      { OPENCODE_DESTRUCTIVE_GUARD_MODE: "warn" },
    );
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("bash command blocked by policy"),
      },
    });
  });

  it("records Codex user prompt policy commands", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-prompt-"));
    const result = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "UserPromptSubmit",
        session_id: "codex-prompt-session",
        cwd: rootDir,
        prompt: "/policy skill-loaded sdlc\n/policy override reviewed by human",
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: expect.stringContaining("Policy command state was recorded"),
      },
    });

    const state = await runGroundwork([
      "session",
      "get",
      JSON.stringify({ root_dir: rootDir, session_id: "codex-prompt-session" }),
    ]);
    expect(parseJson(state.stdout)).toMatchObject({
      data: {
        state: {
          policy: {
            confirmedSkills: ["sdlc"],
            overrides: [expect.objectContaining({ reason: "reviewed by human" })],
          },
        },
      },
    });
  });

  it("denies risky Codex PermissionRequest hooks", async () => {
    const result = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PermissionRequest",
        tool_name: "Bash",
        tool_input: {
          command: "git reset --hard",
        },
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      hookSpecificOutput: {
        hookEventName: "PermissionRequest",
        decision: {
          behavior: "deny",
          message: expect.stringContaining("[groundwork:risk]"),
        },
      },
    });
  });

  it("reports Codex PostToolUse policy feedback without prevention claims", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-post-"));
    await fs.mkdir(path.join(rootDir, ".opencode"), { recursive: true });
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), "const before = true;\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, ".opencode", "policy.toml"),
      `version = 1

[[rules]]
id = "no-console"
match = ["src/**"]
content_scope = "changed_lines"

[[rules.content]]
type = "ast_grep"
language = "ts"
pattern = "console.log($A)"

[[rules.actions]]
type = "block_tool"
message = "console logging is blocked"
`,
      "utf8",
    );

    const patchText = "*** Begin Patch\n*** Update File: src/main.ts\n@@\n-const before = true;\n+console.log(\"after\");\n*** End Patch\n";
    const pre = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "codex-post-session",
        cwd: rootDir,
        tool_name: "apply_patch",
        tool_use_id: "post-call",
        tool_input: { patchText },
      }),
    );
    expect(pre.exitCode).toBe(0);
    expect(pre.stdout).toBe("");
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), 'console.log("after");\n', "utf8");

    const post = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "codex-post-session",
        cwd: rootDir,
        tool_name: "apply_patch",
        tool_use_id: "post-call",
        tool_input: { patchText },
        tool_response: { ok: true },
      }),
    );
    expect(parseJson(post.stdout)).toMatchObject({
      decision: "block",
      reason: expect.stringContaining("Side effects may already have happened"),
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining("cannot undo side effects"),
      },
    });
  }, 35_000);

  it("keeps Codex PostToolUse warnings non-blocking", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-post-warn-"));
    await fs.mkdir(path.join(rootDir, ".opencode"), { recursive: true });
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), "const before = true;\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, ".opencode", "policy.toml"),
      `version = 1

[[rules]]
id = "warn-console"
match = ["src/**"]
severity = "warn"
content_scope = "changed_lines"

[[rules.content]]
type = "ast_grep"
language = "ts"
pattern = "console.log($A)"

[[rules.actions]]
type = "block_tool"
message = "console logging should be reviewed"
`,
      "utf8",
    );

    const patchText = "*** Begin Patch\n*** Update File: src/main.ts\n@@\n-const before = true;\n+console.log(\"after\");\n*** End Patch\n";
    await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "codex-post-warn-session",
        cwd: rootDir,
        tool_name: "apply_patch",
        tool_use_id: "post-warn-call",
        tool_input: { patchText },
      }),
    );
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), 'console.log("after");\n', "utf8");

    const post = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "codex-post-warn-session",
        cwd: rootDir,
        tool_name: "apply_patch",
        tool_use_id: "post-warn-call",
        tool_response: { ok: true },
      }),
    );
    const parsed = parseJson(post.stdout) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("decision");
    expect(parsed).toMatchObject({
      systemMessage: expect.stringContaining("console logging should be reviewed"),
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining("non-blocking"),
      },
    });
  }, 35_000);

  it("returns JSON feedback for invalid Codex hook payloads", async () => {
    const result = await runGroundwork(["codex", "hook"], "{");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      systemMessage: expect.stringContaining("invalid Codex hook JSON"),
    });
  });

  it("lists and shows schemas", async () => {
    const listResult = await runGroundwork(["schema", "list"]);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stderr).toBe("");
    expect(parseJson(listResult.stdout)).toMatchObject({
      ok: true,
      command: "schema list",
      data: {
        schemas: expect.arrayContaining([
          expect.objectContaining({
            schema_id: "groundwork.risk.evaluate-command.input/v1",
          }),
        ]),
      },
    });

    const showResult = await runGroundwork([
      "schema",
      "show",
      "groundwork.risk.evaluate-command.input/v1",
    ]);
    expect(showResult.exitCode).toBe(0);
    expect(showResult.stderr).toBe("");
    expect(parseJson(showResult.stdout)).toMatchObject({
      ok: true,
      command: "schema show",
      data: {
        schema_id: "groundwork.risk.evaluate-command.input/v1",
        schema: {
          additionalProperties: false,
        },
      },
    });

    const sessionShowResult = await runGroundwork([
      "schema",
      "show",
      "groundwork.session.skill-loaded.input/v1",
    ]);
    expect(sessionShowResult.exitCode).toBe(0);
    expect(sessionShowResult.stderr).toBe("");
    expect(parseJson(sessionShowResult.stdout)).toMatchObject({
      ok: true,
      command: "schema show",
      data: {
        schema_id: "groundwork.session.skill-loaded.input/v1",
        command_id: "session.skill-loaded",
      },
    });
  });

  it("lists and shows examples", async () => {
    const listResult = await runGroundwork(["examples", "list"]);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stderr).toBe("");
    expect(parseJson(listResult.stdout)).toMatchObject({
      ok: true,
      command: "examples list",
      data: {
        examples: expect.arrayContaining([
          expect.objectContaining({ command_id: "risk.evaluate-command" }),
        ]),
      },
    });

    const showResult = await runGroundwork(["examples", "show", "risk.evaluate-command"]);
    expect(showResult.exitCode).toBe(0);
    expect(showResult.stderr).toBe("");
    expect(parseJson(showResult.stdout)).toMatchObject({
      ok: true,
      command: "examples show",
      data: {
        command_id: "risk.evaluate-command",
      },
    });
  });

  it("evaluates risky commands through the risk foundation", async () => {
    const result = await runGroundwork([
      "risk",
      "evaluate-command",
      '{"command":"git checkout -- src/index.ts"}',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "risk evaluate-command",
      data: {
        decision: "block",
        violation: {
          ruleId: "git.checkout-discard",
        },
      },
    });
  });

  it("honors risk foundation warn and off modes", async () => {
    const warnResult = await runGroundwork([
      "risk",
      "evaluate-command",
      '{"command":"git reset --hard","config":{"mode":"warn"}}',
    ]);
    expect(warnResult.exitCode).toBe(0);
    expect(parseJson(warnResult.stdout)).toMatchObject({
      ok: true,
      command: "risk evaluate-command",
      data: {
        decision: "warn",
        violation: {
          ruleId: "git.reset-hard",
        },
      },
    });

    const offResult = await runGroundwork([
      "risk",
      "evaluate-command",
      '{"command":"git reset --hard","config":{"mode":"off"}}',
    ]);
    expect(offResult.exitCode).toBe(0);
    expect(parseJson(offResult.stdout)).toMatchObject({
      ok: true,
      command: "risk evaluate-command",
      data: {
        decision: "allow",
        violation: null,
        config: {
          mode: "off",
        },
      },
    });
  });

  it("rejects extra input properties consistently with published schemas", async () => {
    const result = await runGroundwork([
      "risk",
      "evaluate-command",
      '{"command":"echo ok","extra":true}',
    ]);
    expectJsonOnlyFailure(result);
    expect(parseJson(result.stderr)).toMatchObject({
      ok: false,
      command: "risk evaluate-command",
      error: {
        type: "CliInputError",
        message: "Input failed schema validation",
      },
    });
  });

  it("returns failure envelopes for invalid JSON input", async () => {
    const result = await runGroundwork(["risk", "evaluate-command", "{"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(parseJson(result.stderr)).toMatchObject({
      ok: false,
      command: "risk evaluate-command",
      error: {
        type: "CliInputError",
      },
    });
  });

  it("returns JSON-only failure envelopes for missing parser arguments", async () => {
    const result = await runGroundwork(["risk", "evaluate-command"]);
    expectJsonOnlyFailure(result);
    expect(parseJson(result.stderr)).toMatchObject({
      ok: false,
      command: "risk evaluate-command",
      error: {
        type: "CliInputError",
        message: "Missing required argument 'input'",
      },
    });
  });

  it("returns JSON-only failure envelopes for unknown parser commands", async () => {
    const result = await runGroundwork(["unknown"]);
    expectJsonOnlyFailure(result);
    expect(parseJson(result.stderr)).toMatchObject({
      ok: false,
      error: {
        type: "CliInputError",
        message: "Unknown command 'unknown'",
        details: {
          expected: expect.arrayContaining(["policy"]),
        },
      },
    });
  });

  it("accepts @file JSON input", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-cli-"));
    const inputPath = path.join(tempDir, "risk.json");
    await fs.writeFile(inputPath, JSON.stringify({ command: "echo ok" }), "utf8");

    const result = await runGroundwork(["risk", "evaluate-command", `@${inputPath}`]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "risk evaluate-command",
      data: {
        decision: "allow",
        violation: null,
      },
    });
  });

  it("accepts stdin JSON input", async () => {
    const result = await runGroundwork(
      ["risk", "evaluate-command", "-"],
      JSON.stringify({ command: "git reset --hard" }),
    );
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "risk evaluate-command",
      data: {
        decision: "block",
        violation: {
          ruleId: "git.reset-hard",
        },
      },
    });
  });

  it("discovers inherited context files", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-context-"));
    const directory = path.join(rootDir, "packages", "app");
    await fs.mkdir(path.join(directory, "src"), { recursive: true });
    await fs.writeFile(path.join(directory, "AGENTS.md"), "Use local app guidance.\n", "utf8");
    await fs.writeFile(path.join(directory, "src", "index.ts"), "export {};\n", "utf8");

    const result = await runGroundwork([
      "context",
      "discover",
      JSON.stringify({
        target_path: "src/index.ts",
        directory,
        root_dir: rootDir,
      }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "context discover",
      data: {
        files: [
          expect.objectContaining({
            fileName: "AGENTS.md",
            content: "Use local app guidance.\n",
          }),
        ],
      },
    });
  });

  it("inspects local repository state", async () => {
    const result = await runGroundwork(["provenance", "repo-state", '{"limit":1}']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "provenance repo-state",
      data: {
        branch: expect.objectContaining({
          name: expect.any(String),
        }),
        base: expect.objectContaining({
          ref: expect.any(String),
        }),
      },
    });
  });

  it("inspects local file state", async () => {
    const result = await runGroundwork([
      "provenance",
      "file-state",
      '{"path":"src/index.ts"}',
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "provenance file-state",
      data: {
        requestedPath: "src/index.ts",
      },
    });
  });

  it("persists and cleans up durable session artifacts", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-session-"));
    const sessionId = "codex-session-1";

    const skillResult = await runGroundwork([
      "session",
      "skill-loaded",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        skills: ["Groundwork", "Policy"],
      }),
    ]);
    expect(skillResult.exitCode).toBe(0);
    expect(skillResult.stderr).toBe("");
    expect(parseJson(skillResult.stdout)).toMatchObject({
      ok: true,
      command: "session skill-loaded",
      data: {
        state: {
          policy: {
            confirmedSkills: ["groundwork", "policy"],
          },
        },
      },
    });

    const overrideResult = await runGroundwork([
      "session",
      "override",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        reason: "human approved",
        rule_id: "rule-1",
      }),
    ]);
    expect(overrideResult.exitCode).toBe(0);

    const firstActionResult = await runGroundwork([
      "session",
      "remember-action",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        key: "policy:rule-1:inject",
        source: "policy",
        action: "inject_prompt",
      }),
    ]);
    expect(firstActionResult.exitCode).toBe(0);
    expect(parseJson(firstActionResult.stdout)).toMatchObject({
      data: {
        duplicate: false,
      },
    });

    const secondActionResult = await runGroundwork([
      "session",
      "remember-action",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        key: "policy:rule-1:inject",
        source: "policy",
        action: "inject_prompt",
      }),
    ]);
    expect(secondActionResult.exitCode).toBe(0);
    expect(parseJson(secondActionResult.stdout)).toMatchObject({
      data: {
        duplicate: true,
        state: {
          actions: {
            "policy:rule-1:inject": {
              count: 2,
            },
          },
        },
      },
    });

    const pendingResult = await runGroundwork([
      "session",
      "put-pending-tool",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        call_id: "call-1",
        tool_name: "bash",
        args: { command: "echo ok" },
        targets: [{ path: "src/index.ts" }],
      }),
    ]);
    expect(pendingResult.exitCode).toBe(0);

    const traceResult = await runGroundwork([
      "session",
      "append-trace",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        trace: { id: "trace-1", kind: "test" },
      }),
    ]);
    expect(traceResult.exitCode).toBe(0);
    expect(parseJson(traceResult.stdout)).toMatchObject({
      ok: true,
      command: "session append-trace",
      data: {
        session_id: sessionId,
        trace_file: expect.stringContaining("traces.jsonl"),
      },
    });

    const getResult = await runGroundwork([
      "session",
      "get",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
      }),
    ]);
    expect(getResult.exitCode).toBe(0);
    expect(parseJson(getResult.stdout)).toMatchObject({
      ok: true,
      command: "session get",
      data: {
        state: {
          schemaVersion: "groundwork-session-artifacts/v1",
          policy: {
            overrides: [expect.objectContaining({ ruleId: "rule-1" })],
          },
          session: {
            pendingTools: {
              calls: {
                "call-1": expect.objectContaining({
                  toolName: "bash",
                }),
              },
            },
          },
        },
      },
    });

    const sessionDirs = await fs.readdir(path.join(rootDir, ".groundwork", "sessions"));
    expect(sessionDirs).toHaveLength(1);
    const sessionDir = path.join(rootDir, ".groundwork", "sessions", sessionDirs[0] ?? "");
    await expect(fs.readFile(path.join(sessionDir, "events.jsonl"), "utf8")).resolves.toContain(
      "skill-loaded",
    );
    await expect(fs.readFile(path.join(sessionDir, "traces.jsonl"), "utf8")).resolves.toContain(
      "trace-1",
    );

    const cleanupResult = await runGroundwork([
      "session",
      "cleanup",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
      }),
    ]);
    expect(cleanupResult.exitCode).toBe(0);
    expect(parseJson(cleanupResult.stdout)).toMatchObject({
      ok: true,
      command: "session cleanup",
      data: {
        removed: [sessionId],
      },
    });

    const missingCleanupResult = await runGroundwork([
      "session",
      "cleanup",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
      }),
    ]);
    expect(missingCleanupResult.exitCode).toBe(0);
    expect(parseJson(missingCleanupResult.stdout)).toMatchObject({
      ok: true,
      command: "session cleanup",
      data: {
        removed: [],
      },
    });
  });

  it("evaluates policy prompt guidance and blocks strict skill gates", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-cli-"));
    await fs.mkdir(path.join(rootDir, ".opencode"), { recursive: true });
    await fs.writeFile(
      path.join(rootDir, ".opencode", "policy.toml"),
      `version = 1

[[rules]]
id = "guidance"
match = ["src/**"]

[[rules.actions]]
type = "ensure_skill_loaded"
skills = ["sdlc"]
mode = "prompt"

[[rules]]
id = "strict-skill"
match = ["secure/**"]

[[rules.actions]]
type = "ensure_skill_loaded"
skills = ["security-reviewer"]
mode = "block"
`,
      "utf8",
    );

    const guidance = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "policy-session",
        tool: "edit",
        call_id: "call-guidance",
        args: { filePath: "src/main.ts" },
      }),
    ]);
    expect(guidance.exitCode).toBe(0);
    expect(guidance.stderr).toBe("");
    expect(parseJson(guidance.stdout)).toMatchObject({
      ok: true,
      command: "policy evaluate-tool-call",
      data: {
        decision: "allow",
        messages: [expect.objectContaining({ action_type: "ensure_skill_loaded" })],
      },
    });

    const blocked = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "policy-session",
        tool: "edit",
        call_id: "call-strict-1",
        args: { filePath: "secure/auth.ts" },
      }),
    ]);
    expect(blocked.exitCode).toBe(0);
    expect(parseJson(blocked.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "block",
        violations: [expect.objectContaining({ rule_id: "strict-skill", blocking: true })],
      },
    });

    const skillLoaded = await runGroundwork([
      "policy",
      "skill-loaded",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "policy-session",
        skills: ["security-reviewer"],
      }),
    ]);
    expect(skillLoaded.exitCode).toBe(0);

    const allowed = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "policy-session",
        tool: "edit",
        call_id: "call-strict-2",
        args: { filePath: "secure/auth.ts" },
      }),
    ]);
    expect(parseJson(allowed.stdout)).toMatchObject({
      ok: true,
      data: { decision: "allow", violations: [] },
    });
  });

  it("uses policy override locks and post-tool result evaluation", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-cli-"));
    await fs.mkdir(path.join(rootDir, ".opencode"), { recursive: true });
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), "const before = true;\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, ".opencode", "policy.toml"),
      `version = 1

[[rules]]
id = "human-override-required"
match = ["infra/prod/**"]

[[rules.actions]]
type = "require_human_override"

[[rules]]
id = "no-console"
match = ["src/**"]
content_scope = "changed_lines"

[[rules.content]]
type = "ast_grep"
language = "ts"
pattern = "console.log($A)"

[[rules.actions]]
type = "block_tool"
message = "console logging is blocked"
`,
      "utf8",
    );

    const blocked = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        tool: "edit",
        call_id: "override-1",
        args: { filePath: "infra/prod/main.tf" },
      }),
    ]);
    expect(parseJson(blocked.stdout)).toMatchObject({
      ok: true,
      data: { decision: "block" },
    });

    const locked = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        tool: "write",
        call_id: "override-2",
        args: { filePath: "README.md" },
      }),
    ]);
    expect(parseJson(locked.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "block",
        messages: [expect.objectContaining({ text: expect.stringContaining("Mutating tools") })],
      },
    });

    const override = await runGroundwork([
      "policy",
      "override",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        reason: "human reviewed",
      }),
    ]);
    expect(override.exitCode).toBe(0);

    const patchText = `*** Begin Patch
*** Update File: src/main.ts
@@
-const before = true;
+console.log("after");
*** End Patch
`;
    const before = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        tool: "edit",
        call_id: "post-1",
        args: { filePath: "src/main.ts", patchText },
      }),
    ]);
    expect(parseJson(before.stdout)).toMatchObject({
      ok: true,
      data: { decision: "allow" },
    });
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), 'console.log("after");\n', "utf8");

    const after = await runGroundwork([
      "policy",
      "evaluate-tool-result",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        call_id: "post-1",
      }),
    ]);
    expect(parseJson(after.stdout)).toMatchObject({
      ok: true,
      command: "policy evaluate-tool-result",
      data: {
        decision: "block",
        phase: "after",
        violations: [expect.objectContaining({ rule_id: "no-console" })],
      },
    });
  }, 35_000);

  it("keeps distinct unsafe-looking session ids isolated on disk", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-session-collision-"));

    await runGroundwork([
      "session",
      "skill-loaded",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "a/b",
        skills: ["one"],
      }),
    ]);
    await runGroundwork([
      "session",
      "skill-loaded",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "a:b",
        skills: ["two"],
      }),
    ]);
    await runGroundwork([
      "session",
      "skill-loaded",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "a_b",
        skills: ["three"],
      }),
    ]);

    const sessionDirs = await fs.readdir(path.join(rootDir, ".groundwork", "sessions"));
    expect(sessionDirs).toHaveLength(3);

    const cleanupResult = await runGroundwork([
      "session",
      "cleanup",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "a/b",
      }),
    ]);
    expect(cleanupResult.exitCode).toBe(0);

    const remainingDirs = await fs.readdir(path.join(rootDir, ".groundwork", "sessions"));
    expect(remainingDirs).toHaveLength(2);
    const colonResult = await runGroundwork([
      "session",
      "get",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "a:b",
      }),
    ]);
    expect(parseJson(colonResult.stdout)).toMatchObject({
      data: {
        state: {
          policy: {
            confirmedSkills: ["two"],
          },
        },
      },
    });
  });

  it("serializes concurrent session mutations", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-session-concurrent-"));
    const sessionId = "parallel-session";

    const [skillResult, overrideResult, actionResult, pendingResult] = await Promise.all([
      runGroundwork([
        "session",
        "skill-loaded",
        JSON.stringify({ root_dir: rootDir, session_id: sessionId, skills: ["groundwork"] }),
      ]),
      runGroundwork([
        "session",
        "override",
        JSON.stringify({ root_dir: rootDir, session_id: sessionId, reason: "approved" }),
      ]),
      runGroundwork([
        "session",
        "remember-action",
        JSON.stringify({
          root_dir: rootDir,
          session_id: sessionId,
          key: "dedupe-key",
          source: "test",
          action: "remember",
        }),
      ]),
      runGroundwork([
        "session",
        "put-pending-tool",
        JSON.stringify({
          root_dir: rootDir,
          session_id: sessionId,
          call_id: "call-parallel",
          tool_name: "Bash",
        }),
      ]),
    ]);
    expect(skillResult.exitCode).toBe(0);
    expect(overrideResult.exitCode).toBe(0);
    expect(actionResult.exitCode).toBe(0);
    expect(pendingResult.exitCode).toBe(0);

    const getResult = await runGroundwork([
      "session",
      "get",
      JSON.stringify({ root_dir: rootDir, session_id: sessionId }),
    ]);
    expect(getResult.exitCode).toBe(0);
    expect(parseJson(getResult.stdout)).toMatchObject({
      data: {
        state: {
          policy: {
            confirmedSkills: ["groundwork"],
            overrides: [expect.objectContaining({ reason: "approved" })],
          },
          actions: {
            "dedupe-key": expect.objectContaining({ count: 1 }),
          },
          session: {
            pendingTools: {
              calls: {
                "call-parallel": expect.objectContaining({ toolName: "Bash" }),
              },
            },
          },
        },
      },
    });
  });
});
