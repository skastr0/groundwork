import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attachProcessRunner } from "../../shared/effect-runtime.ts";
import {
  createFrameworkProvenanceTools,
  type FrameworkProvenanceToolID,
} from "../provenance/registry.ts";

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const CLI_ENTRY = path.resolve(process.cwd(), "src", "cli.ts");

async function runGroundwork(
  args: string[],
  stdin?: string,
  options: { cwd?: string; env?: Record<string, string> } = {},
): Promise<CommandResult> {
  const proc = spawn("bun", [CLI_ENTRY, ...args], {
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

function expectDefaultHookCommand(command: string) {
  expect(command).toMatch(/'[^']*bun[^']*' '[^']*src\/cli\.ts' codex hook$/);
}

function firstHookCommand(hooksConfig: {
  hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
}): string {
  return hooksConfig.hooks["PreToolUse"]?.[0]?.hooks[0]?.command ?? "";
}

async function runRegistryProvenanceTool(
  tool: FrameworkProvenanceToolID,
  args: Record<string, unknown>,
  rootDir = process.cwd(),
): Promise<unknown> {
  const tools = createFrameworkProvenanceTools({
    shell: attachProcessRunner({}, { cwd: rootDir }) as never,
    rootDir,
  });
  const result = await tools[tool].execute(args, {
    sessionID: "groundwork-cli-test",
    messageID: "groundwork-cli-test",
    agent: "groundwork-cli-test",
    directory: rootDir,
    worktree: rootDir,
    abort: new AbortController().signal,
    metadata() {},
    async ask() {},
  } as never);
  return parseJson(result);
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
          expect.objectContaining({ name: "plugin.hooks", ok: true }),
          expect.objectContaining({ name: "project.codex_config", ok: true }),
          expect.objectContaining({ name: "project.codex_hooks", ok: true }),
        ]),
      },
    });
  });

  it("reports missing Codex integration readiness outside configured projects", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-doctor-"));

    const missingResult = await runGroundwork(["codex", "doctor"], undefined, {
      cwd: targetDir,
    });
    expect(missingResult.exitCode).toBe(0);
    expect(parseJson(missingResult.stdout)).toMatchObject({
      ok: true,
      command: "codex doctor",
      data: {
        integration: "codex",
        status: "missing",
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "plugin.manifest", ok: false }),
          expect.objectContaining({ name: "plugin.hooks", ok: false }),
          expect.objectContaining({ name: "project.codex_config", ok: false }),
          expect.objectContaining({ name: "project.codex_hooks", ok: false }),
        ]),
      },
    });

    await fs.mkdir(path.join(targetDir, ".codex"), { recursive: true });
    const emptyCodexResult = await runGroundwork(["codex", "doctor"], undefined, {
      cwd: targetDir,
    });
    expect(parseJson(emptyCodexResult.stdout)).toMatchObject({
      data: {
        status: "missing",
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "project.codex_config", ok: false }),
          expect.objectContaining({ name: "project.codex_hooks", ok: false }),
        ]),
      },
    });

    await runGroundwork(
      ["codex", "install-project", JSON.stringify({ target_dir: targetDir })],
      undefined,
    );
    const nestedDir = path.join(targetDir, "nested", "package");
    await fs.mkdir(nestedDir, { recursive: true });
    const installedResult = await runGroundwork(["codex", "doctor"], undefined, {
      cwd: nestedDir,
    });
    expect(parseJson(installedResult.stdout)).toMatchObject({
      data: {
        project_root: await fs.realpath(targetDir),
        status: "partial",
        checks: expect.arrayContaining([
          expect.objectContaining({ name: "plugin.manifest", ok: false }),
          expect.objectContaining({ name: "plugin.hooks", ok: false }),
          expect.objectContaining({ name: "project.codex_config", ok: true }),
          expect.objectContaining({ name: "project.codex_hooks", ok: true }),
        ]),
      },
    });
  });

  it("does not treat user Codex home as project-local readiness", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.homedir(), ".groundwork-codex-doctor-"));

    try {
      const result = await runGroundwork(["codex", "doctor"], undefined, {
        cwd: targetDir,
      });
      expect(result.exitCode).toBe(0);
      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          project_root: await fs.realpath(targetDir),
          status: "missing",
          checks: expect.arrayContaining([
            expect.objectContaining({ name: "project.codex_config", ok: false }),
            expect.objectContaining({ name: "project.codex_hooks", ok: false }),
          ]),
        },
      });
    } finally {
      await fs.rm(targetDir, { recursive: true, force: true });
    }
  });

  it("canonicalizes user Codex home boundaries before project readiness discovery", async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-home-"));
    const childDir = path.join(homeDir, "workspace", "child");
    await fs.mkdir(path.join(homeDir, ".codex"), { recursive: true });
    await fs.writeFile(path.join(homeDir, ".codex", "config.toml"), "codex_hooks = true\n", "utf8");
    await fs.writeFile(path.join(homeDir, ".codex", "hooks.json"), '{"hooks":{}}\n', "utf8");
    await fs.mkdir(childDir, { recursive: true });

    try {
      const result = await runGroundwork(["codex", "doctor"], undefined, {
        cwd: await fs.realpath(childDir),
        env: {
          HOME: homeDir,
          CODEX_HOME: path.join(homeDir, ".codex"),
        },
      });
      expect(result.exitCode).toBe(0);
      expect(parseJson(result.stdout)).toMatchObject({
        data: {
          project_root: await fs.realpath(childDir),
          status: "missing",
          checks: expect.arrayContaining([
            expect.objectContaining({ name: "project.codex_config", ok: false }),
            expect.objectContaining({ name: "project.codex_hooks", ok: false }),
          ]),
        },
      });
    } finally {
      await fs.rm(homeDir, { recursive: true, force: true });
    }
  });

  it("installs project-local Codex hooks and config files", async () => {
    const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-project-"));
    const result = await runGroundwork([
      "codex",
      "install-project",
      JSON.stringify({ target_dir: targetDir }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = parseJson(result.stdout);
    expect(parsed).toMatchObject({
      ok: true,
      command: "codex install-project",
      data: {
        target_dir: targetDir,
        files: expect.arrayContaining([
          expect.objectContaining({ action: "created" }),
        ]),
      },
    });
    expectDefaultHookCommand((parsed as { data: { hook_command: string } }).data.hook_command);

    await expect(fs.readFile(path.join(targetDir, ".codex", "config.toml"), "utf8")).resolves.toContain(
      "codex_hooks = true",
    );
    const hooksConfig = JSON.parse(await fs.readFile(path.join(targetDir, ".codex", "hooks.json"), "utf8"));
    expectDefaultHookCommand(firstHookCommand(hooksConfig));
    expect(Object.keys(hooksConfig.hooks).sort()).toEqual([
      "PermissionRequest",
      "PostToolUse",
      "PreToolUse",
      "SessionStart",
      "Stop",
      "UserPromptSubmit",
    ]);
    await expect(
      fs.access(path.join(targetDir, ".codex", "skills", "groundwork", "SKILL.md")),
    ).rejects.toThrow();
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
    const hooksConfig = JSON.parse(await fs.readFile(path.join(codexDir, "hooks.json"), "utf8"));
    expectDefaultHookCommand(firstHookCommand(hooksConfig));
  });

  it("installs user-level Codex hooks and config files", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-home-"));
    const result = await runGroundwork([
      "codex",
      "install-user",
      JSON.stringify({ codex_home: codexHome }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = parseJson(result.stdout);
    expect(parsed).toMatchObject({
      ok: true,
      command: "codex install-user",
      data: {
        codex_home: codexHome,
      },
    });
    expectDefaultHookCommand((parsed as { data: { hook_command: string } }).data.hook_command);

    const hooksConfig = JSON.parse(await fs.readFile(path.join(codexHome, "hooks.json"), "utf8"));
    expectDefaultHookCommand(firstHookCommand(hooksConfig));
    await expect(fs.readFile(path.join(codexHome, "config.toml"), "utf8")).resolves.toContain(
      "codex_hooks = true",
    );
    await expect(fs.access(path.join(codexHome, "skills", "groundwork", "SKILL.md"))).rejects.toThrow();
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
      { GROUNDWORK_DESTRUCTIVE_GUARD_MODE: "warn" },
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
      { GROUNDWORK_DESTRUCTIVE_GUARD_MODE: "off" },
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
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
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
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
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
      { GROUNDWORK_DESTRUCTIVE_GUARD_MODE: "warn" },
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
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), "const before = true;\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
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
  }, 120_000);

  it("keeps Codex PostToolUse warnings non-blocking", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-post-warn-"));
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), "const before = true;\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
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
  }, 120_000);

  it("combines Codex PostToolUse policy warnings with context reminders", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-warn-context-"));
    await fs.mkdir(path.join(rootDir, "src", "feature"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "AGENTS.md"), "Use combined context.\n", "utf8");
    await fs.writeFile(path.join(rootDir, "src", "feature", "main.ts"), "const before = true;\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
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

    const patchText = "*** Begin Patch\n*** Update File: src/feature/main.ts\n@@\n-const before = true;\n+console.log(\"after\");\n*** End Patch\n";
    await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PreToolUse",
        session_id: "warn-context-session",
        cwd: rootDir,
        tool_name: "apply_patch",
        tool_use_id: "warn-context-call",
        tool_input: { patchText },
      }),
    );
    await fs.writeFile(path.join(rootDir, "src", "feature", "main.ts"), 'console.log("after");\n', "utf8");

    const post = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({
        hook_event_name: "PostToolUse",
        session_id: "warn-context-session",
        cwd: rootDir,
        tool_name: "apply_patch",
        tool_use_id: "warn-context-call",
        tool_input: { patchText },
      }),
    );
    const parsed = parseJson(post.stdout) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("decision");
    expect(parsed.systemMessage).toEqual(expect.stringContaining("console logging should be reviewed"));
    expect(parsed.systemMessage).toEqual(expect.stringContaining("Use combined context."));
  }, 60_000);

  it("reports Codex PostToolUse context reminders with dedupe", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-codex-context-"));
    await fs.mkdir(path.join(rootDir, "src", "feature"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "AGENTS.md"), "Use Codex context guidance.\n", "utf8");

    const payload = {
      hook_event_name: "PostToolUse",
      session_id: "codex-context-session",
      cwd: rootDir,
      tool_name: "apply_patch",
      tool_use_id: "context-call",
      tool_input: {
        patchText:
          "*** Begin Patch\n*** Add File: src/feature/main.ts\n+export {}\n*** End Patch\n",
      },
    };
    const first = await runGroundwork(["codex", "hook"], JSON.stringify(payload));
    expect(parseJson(first.stdout)).toMatchObject({
      systemMessage: expect.stringContaining("Use Codex context guidance."),
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: expect.stringContaining("not synthetic prompt injection"),
      },
    });

    const second = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({ ...payload, tool_use_id: "context-call-2" }),
    );
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toBe("");
  });

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
    const capabilitiesResult = await runGroundwork(["capabilities"]);
    const advertisedCommandIDs = (
      parseJson(capabilitiesResult.stdout) as {
        data: { commands: Array<{ command_id: string }> };
      }
    ).data.commands.map((command) => command.command_id);

    const listResult = await runGroundwork(["examples", "list"]);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stderr).toBe("");
    const listedExampleIDs = new Set(
      (
        parseJson(listResult.stdout) as {
          data: { examples: Array<{ command_id: string }> };
        }
      ).data.examples.map((example) => example.command_id),
    );
    expect(advertisedCommandIDs.filter((commandID) => !listedExampleIDs.has(commandID))).toEqual([]);
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
    for (const commandID of advertisedCommandIDs) {
      const commandShowResult = await runGroundwork(["examples", "show", commandID]);
      expect(commandShowResult.exitCode, commandID).toBe(0);
      expect(parseJson(commandShowResult.stdout)).toMatchObject({
        ok: true,
        command: "examples show",
        data: {
          command_id: commandID,
          examples: expect.arrayContaining([
            expect.objectContaining({ command_id: commandID }),
          ]),
        },
      });
    }
  }, 60_000);

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

  it("passes root completion generation through to Effect CLI", async () => {
    const result = await runGroundwork(["--completions", "zsh"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("#compdef groundwork");
  });

  it("passes root wizard help through to Effect CLI", async () => {
    const result = await runGroundwork(["--wizard", "--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("groundwork 0.1.0");
  });

  it("allows root log-level before JSON commands without weakening preflight", async () => {
    const success = await runGroundwork(["--log-level", "none", "doctor"]);
    expect(success.exitCode).toBe(0);
    expect(parseJson(success.stdout)).toMatchObject({
      ok: true,
      command: "doctor",
    });

    const missingInput = await runGroundwork(["--log-level=none", "risk", "evaluate-command"]);
    expectJsonOnlyFailure(missingInput);
    expect(parseJson(missingInput.stderr)).toMatchObject({
      ok: false,
      command: "risk evaluate-command",
      error: {
        type: "CliInputError",
        message: "Missing required argument 'input'",
      },
    });

    const invalidLogLevel = await runGroundwork(["--log-level", "doctor"]);
    expectJsonOnlyFailure(invalidLogLevel);
    expect(parseJson(invalidLogLevel.stderr)).toMatchObject({
      ok: false,
      error: {
        type: "CliInputError",
        message: "Invalid value for '--log-level'",
        details: {
          expected: expect.arrayContaining(["none"]),
          received: "doctor",
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

  it("discovers root context files only when explicitly requested", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-context-root-"));
    await fs.writeFile(path.join(rootDir, "AGENTS.md"), "Use root guidance.\n", "utf8");
    await fs.writeFile(path.join(rootDir, "README.md"), "# Demo\n", "utf8");

    const defaultResult = await runGroundwork([
      "context",
      "discover",
      JSON.stringify({
        target_path: "README.md",
        directory: rootDir,
        root_dir: rootDir,
      }),
    ]);
    expect(parseJson(defaultResult.stdout)).toMatchObject({
      ok: true,
      data: {
        include_root: false,
        files: [],
      },
    });

    const includeResult = await runGroundwork([
      "context",
      "discover",
      JSON.stringify({
        target_path: "README.md",
        directory: rootDir,
        root_dir: rootDir,
        include_root: true,
      }),
    ]);
    expect(parseJson(includeResult.stdout)).toMatchObject({
      ok: true,
      command: "context discover",
      data: {
        include_root: true,
        files: [
          expect.objectContaining({
            fileName: "AGENTS.md",
            content: "Use root guidance.\n",
          }),
        ],
      },
    });
  });

  it("uses cwd as the default context discovery directory", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-context-cwd-"));

    const result = await runGroundwork([
      "context",
      "discover",
      JSON.stringify({
        target_path: "README.md",
        root_dir: rootDir,
        include_root: true,
      }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      data: {
        directory: process.cwd(),
        files: [],
      },
    });
  });

  it("dedupes context reminders for touched paths", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-context-touched-"));
    await fs.mkdir(path.join(rootDir, "src", "feature"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "AGENTS.md"), "Use feature guidance.\n", "utf8");
    await fs.writeFile(path.join(rootDir, "src", "feature", "main.ts"), "export {}\n", "utf8");

    const input = {
      root_dir: rootDir,
      session_id: "context-session",
      tool: "edit",
      args: { path: "src/feature/main.ts" },
    };
    const first = await runGroundwork(["context", "touched-paths", JSON.stringify(input)]);
    expect(first.exitCode).toBe(0);
    expect(parseJson(first.stdout)).toMatchObject({
      ok: true,
      command: "context touched-paths",
      data: {
        new_files: [expect.objectContaining({ file_name: "AGENTS.md" })],
        repeated_files: [],
        reminders: [expect.stringContaining("Use feature guidance.")],
      },
    });

    const second = await runGroundwork(["context", "touched-paths", JSON.stringify(input)]);
    expect(parseJson(second.stdout)).toMatchObject({
      data: {
        new_files: [],
        repeated_files: [expect.objectContaining({ file_name: "AGENTS.md" })],
        reminders: [],
      },
    });
  });

  it("includes root context reminders for touched paths when explicitly requested", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-context-root-touched-"));
    await fs.writeFile(path.join(rootDir, "AGENTS.md"), "Use root reminder.\n", "utf8");

    const result = await runGroundwork([
      "context",
      "touched-paths",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "root-context-session",
        include_root: true,
        tool: "edit",
        args: { path: "README.md" },
      }),
    ]);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "context touched-paths",
      data: {
        new_files: [expect.objectContaining({ file_name: "AGENTS.md" })],
        reminders: [expect.stringContaining("Use root reminder.")],
      },
    });
  });

  it("writes context dedupe state under the resolved directory root", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-context-directory-"));
    const directory = path.join(rootDir, "packages", "app");
    await fs.mkdir(path.join(directory, "src"), { recursive: true });
    await fs.writeFile(path.join(directory, "src", "AGENTS.md"), "Use app guidance.\n", "utf8");

    const input = {
      directory,
      session_id: "directory-session",
      tool: "edit",
      args: { path: "src/main.ts" },
    };
    const first = await runGroundwork(["context", "touched-paths", JSON.stringify(input)]);
    expect(parseJson(first.stdout)).toMatchObject({
      data: {
        reminders: [expect.stringContaining("Use app guidance.")],
      },
    });
    const second = await runGroundwork(["context", "touched-paths", JSON.stringify(input)]);
    expect(parseJson(second.stdout)).toMatchObject({
      data: {
        new_files: [],
        repeated_files: [expect.objectContaining({ file_name: "AGENTS.md" })],
      },
    });
    await expect(fs.readdir(path.join(directory, ".groundwork", "sessions"))).resolves.toHaveLength(1);
  });

  it("normalizes explicit context targets safely", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-context-targets-"));
    await fs.mkdir(path.join(rootDir, "src", "feature"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "AGENTS.md"), "Use explicit target guidance.\n", "utf8");
    const result = await runGroundwork([
      "context",
      "touched-paths",
      JSON.stringify({
        root_dir: rootDir,
        directory: rootDir,
        session_id: "target-session",
        targets: [
          { path: path.join(rootDir, "src", "feature", "main.ts") },
          { path: "../outside.ts" },
        ],
      }),
    ]);
    expect(parseJson(result.stdout)).toMatchObject({
      data: {
        new_files: [expect.objectContaining({ file_name: "AGENTS.md" })],
        reminders: [expect.stringContaining("Use explicit target guidance.")],
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

  it("runs full provenance registry tools through direct CLI commands", async () => {
    const result = await runGroundwork([
      "provenance",
      "worktree-overview",
      JSON.stringify({ limit: 1 }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "provenance worktree-overview",
      data: {
        ok: true,
        meta: {
          tool: "gw_worktree_overview",
        },
      },
    });
  }, 30_000);

  it("runs arbitrary gw_* provenance tools through provenance run", async () => {
    const result = await runGroundwork([
      "provenance",
      "run",
      JSON.stringify({
        tool: "gw_read",
        args: { path: "src/cli.ts", max_bytes: 200 },
      }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "provenance run",
      data: {
        ok: true,
        meta: {
          tool: "gw_read",
        },
        data: {
          requestedPath: "src/cli.ts",
        },
      },
    });
  });

  it("keeps gw_block_read available as an explicit blocking provenance command", async () => {
    const result = await runGroundwork([
      "provenance",
      "block-read",
      JSON.stringify({ path: "src/cli.ts", start_line: 1, end_line: 5, max_bytes: 200 }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "provenance block-read",
      data: {
        meta: {
          tool: "gw_block_read",
        },
      },
    });
  });

  it("matches representative OpenCode provenance registry outputs", async () => {
    const cases: Array<{
      command: string;
      tool: FrameworkProvenanceToolID;
      args: Record<string, unknown>;
    }> = [
      {
        command: "worktree-overview",
        tool: "gw_worktree_overview",
        args: { limit: 1 },
      },
      {
        command: "hotspots",
        tool: "gw_hotspots",
        args: { path: "src", limit: 1, max_commits: 5 },
      },
      {
        command: "read",
        tool: "gw_read",
        args: { path: "src/cli.ts", max_bytes: 200 },
      },
    ];

    for (const testCase of cases) {
      const cliResult = await runGroundwork([
        "provenance",
        testCase.command,
        JSON.stringify(testCase.args),
      ]);
      expect(cliResult.exitCode).toBe(0);
      expect(cliResult.stderr).toBe("");
      const cliOutput = parseJson(cliResult.stdout) as { data: unknown };
      await expect(runRegistryProvenanceTool(testCase.tool, testCase.args)).resolves.toEqual(
        cliOutput.data,
      );
    }
  }, 30_000);

  it("publishes exact direct provenance command schemas", async () => {
    const readSchemaResult = await runGroundwork([
      "schema",
      "show",
      "groundwork.provenance.read.input/v1",
    ]);
    expect(readSchemaResult.exitCode).toBe(0);
    expect(parseJson(readSchemaResult.stdout)).toMatchObject({
      data: {
        schema: {
          required: ["path"],
          additionalProperties: false,
          properties: {
            path: { type: "string", minLength: 1 },
          },
        },
      },
    });

    const blockReadSchemaResult = await runGroundwork([
      "schema",
      "show",
      "groundwork.provenance.block-read.input/v1",
    ]);
    expect(blockReadSchemaResult.exitCode).toBe(0);
    expect(parseJson(blockReadSchemaResult.stdout)).toMatchObject({
      data: {
        schema: {
          required: ["path", "start_line", "end_line"],
          additionalProperties: false,
        },
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
  }, 30_000);

  it("renders compact Groundwork session context", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-compaction-"));
    const sessionId = "compact-session";
    await fs.mkdir(path.join(rootDir, "src", "feature"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "AGENTS.md"), "Use compact context.\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
      `version = 1

[[rules]]
id = "needs-override"
match = ["infra/**"]

[[rules.actions]]
type = "require_human_override"
message = "infra needs override"
`,
      "utf8",
    );
    await runGroundwork([
      "session",
      "skill-loaded",
      JSON.stringify({ root_dir: rootDir, session_id: sessionId, skills: ["sdlc"] }),
    ]);
    await runGroundwork([
      "session",
      "override",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        reason: "approved",
        rule_id: "rule-1",
      }),
    ]);
    await runGroundwork([
      "context",
      "touched-paths",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        targets: [{ path: "src/feature/main.ts" }],
      }),
    ]);
    await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        tool: "edit",
        args: { path: "infra/main.tf" },
      }),
    ]);
    await runGroundwork([
      "session",
      "append-trace",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        trace: { kind: "test-trace" },
      }),
    ]);

    const result = await runGroundwork([
      "session",
      "render-compaction",
      JSON.stringify({ root_dir: rootDir, session_id: sessionId }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "session render-compaction",
      data: {
        summary: {
          confirmed_skills: ["sdlc"],
          overrides: [expect.objectContaining({ reason: "approved" })],
          active_locks: [expect.objectContaining({ reason: "infra needs override" })],
          context_reminders: [expect.objectContaining({ path: expect.stringContaining("AGENTS.md") })],
          recent_traces: [expect.objectContaining({ trace: { kind: "test-trace" } })],
        },
        text: expect.stringContaining("Confirmed skills: sdlc"),
      },
    });
    expect(parseJson(result.stdout)).toMatchObject({
      data: {
        text: expect.stringContaining("infra needs override"),
      },
    });
  }, 30_000);

  it("renders empty compact session context", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-compaction-empty-"));
    const result = await runGroundwork([
      "session",
      "render-compaction",
      JSON.stringify({ root_dir: rootDir, session_id: "empty-session" }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toMatchObject({
      data: {
        summary: {
          confirmed_skills: [],
          active_locks: [],
          recent_traces: [],
        },
        text: expect.stringContaining("Confirmed skills: none"),
      },
    });
  });

  it("returns session ids for stale session cleanup", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-cleanup-stale-"));
    const sessionId = "cleanup-session";
    await runGroundwork([
      "session",
      "skill-loaded",
      JSON.stringify({ root_dir: rootDir, session_id: sessionId, skills: ["sdlc"] }),
    ]);
    const sessionRoot = path.join(rootDir, ".groundwork", "sessions");
    const [encodedDir] = await fs.readdir(sessionRoot);
    if (!encodedDir) throw new Error("missing session dir");
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    await fs.utimes(path.join(sessionRoot, encodedDir), old, old);
    const cleanup = await runGroundwork([
      "session",
      "cleanup",
      JSON.stringify({ root_dir: rootDir, older_than_days: 1 }),
    ]);
    expect(parseJson(cleanup.stdout)).toMatchObject({
      data: {
        removed: [sessionId],
      },
    });
  });

  it("keeps Codex Stop hook non-continuing", async () => {
    const result = await runGroundwork(
      ["codex", "hook"],
      JSON.stringify({ hook_event_name: "Stop", stop_hook_active: false }),
    );
    expect(result.exitCode).toBe(0);
    expect(parseJson(result.stdout)).toEqual({});
  });

  it("evaluates policy prompt guidance and blocks strict skill gates", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-cli-"));
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
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
  }, 30_000);

  it("uses policy override locks and post-tool result evaluation", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-cli-"));
    await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
    await fs.writeFile(path.join(rootDir, "src", "main.ts"), "const before = true;\n", "utf8");
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
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
  }, 120_000);

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
  }, 60_000);

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
