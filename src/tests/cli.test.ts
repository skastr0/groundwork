import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attachProcessRunner } from "../../packages/core/src/shared/effect-runtime.ts";
import {
  createFrameworkProvenanceTools,
  type FrameworkProvenanceToolID,
} from "../../packages/core/src/provenance/registry.ts";

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

async function runProcess(command: string, args: string[], cwd: string): Promise<void> {
  const proc = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${stderr}`);
  }
}

async function createProvenanceFixtureRepo(): Promise<string> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-provenance-fixture-"));
  await runProcess("git", ["init"], rootDir);
  await runProcess("git", ["config", "user.email", "groundwork@example.com"], rootDir);
  await runProcess("git", ["config", "user.name", "Groundwork Test"], rootDir);
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "src", "cli.ts"), "export const fixture = 1;\n", "utf8");
  await runProcess("git", ["add", "src/cli.ts"], rootDir);
  await runProcess("git", ["commit", "-m", "test fixture"], rootDir);
  await fs.writeFile(path.join(rootDir, "src", "cli.ts"), "export const fixture = 2;\n", "utf8");
  return rootDir;
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
        output: {
          data_shapes: {
            direct_provenance_state: expect.stringContaining("local state DTOs"),
            provenance_result: expect.stringContaining("nested gw_* provenance result envelope"),
          },
        },
        commands: expect.arrayContaining([
          expect.objectContaining({
            command: "provenance repo-state",
            output_shape: "direct_provenance_state",
          }),
          expect.objectContaining({
            command: "provenance file-state",
            output_shape: "direct_provenance_state",
          }),
          expect.objectContaining({
            command: "provenance worktree-overview",
            output_shape: "provenance_result",
          }),
          expect.objectContaining({
            command: "provenance run",
            output_shape: "provenance_result",
          }),
        ]),
      },
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
          expect.objectContaining({
            command_id: "risk.evaluate-command",
            example_count: 1,
          }),
          expect.objectContaining({
            command_id: "context.discover",
            example_count: 2,
            examples: expect.arrayContaining([
              expect.objectContaining({
                name: "Find instruction file metadata without full content",
              }),
            ]),
          }),
          expect.objectContaining({
            command_id: "session.get",
            example_count: 2,
            examples: expect.arrayContaining([
              expect.objectContaining({
                name: "Read compact durable session summary",
              }),
            ]),
          }),
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

  it("renders discoverable help for agent-facing commands", async () => {
    const root = await runGroundwork(["--help"]);
    expect(root.exitCode).toBe(0);
    expect(root.stderr).toBe("");
    expect(root.stdout).toContain("groundwork capabilities");
    expect(root.stdout).toContain("groundwork schema show <command>");
    expect(root.stdout).toContain("groundwork examples show <command>");
    expect(root.stdout).toContain(
      "Describe the Groundwork CLI protocol and command surface",
    );

    const policy = await runGroundwork(["policy", "--help"]);
    expect(policy.exitCode).toBe(0);
    expect(policy.stdout).toContain("Evaluate one pre-tool call against Groundwork policy.");
    expect(policy.stdout).toContain("Record a one-shot human override for audit");

    const provenance = await runGroundwork(["provenance", "--help"]);
    expect(provenance.exitCode).toBe(0);
    expect(provenance.stdout).toContain("Inspect local repository state.");
    expect(provenance.stdout).toContain(
      "Run gw_span_history through the shared local provenance registry.",
    );

    const schema = await runGroundwork(["schema", "--help"]);
    expect(schema.exitCode).toBe(0);
    expect(schema.stdout).toContain("List published JSON input schema contracts.");
    expect(schema.stdout).toContain(
      "Show one published JSON input schema contract by schema id, command id, or command.",
    );
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
        include_content: true,
        files: [
          expect.objectContaining({
            fileName: "AGENTS.md",
            content: "Use local app guidance.\n",
          }),
        ],
      },
    });

    const compactResult = await runGroundwork([
      "context",
      "discover",
      JSON.stringify({
        target_path: "src/index.ts",
        directory,
        root_dir: rootDir,
        include_content: false,
      }),
    ]);
    const compact = parseJson(compactResult.stdout) as {
      data: { files: Array<{ content?: string; content_bytes?: number }> };
    };
    expect(compact).toMatchObject({
      data: {
        include_content: false,
        files: [
          expect.objectContaining({
            fileName: "AGENTS.md",
            content_bytes: Buffer.byteLength("Use local app guidance.\n", "utf8"),
          }),
        ],
      },
    });
    expect(compact.data.files[0]?.content).toBeUndefined();
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
          detached: expect.any(Boolean),
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
        base: expect.objectContaining({ confidence: expect.any(String) }),
        head: expect.objectContaining({ confidence: expect.any(String) }),
        index: expect.objectContaining({ confidence: expect.any(String) }),
        worktree: expect.objectContaining({ confidence: expect.any(String) }),
        ambiguity: expect.objectContaining({
          level: expect.any(String),
        }),
      },
    });
  });

  it("normalizes absolute file-state paths consistently across direct and registry commands", async () => {
    const rootDir = process.cwd();
    const packagePath = path.join("packages", "core", "src", "provenance", "tooling", "state", "index.ts");
    const absolutePath = path.join(rootDir, packagePath);
    const directResult = await runGroundwork([
      "provenance",
      "file-state",
      JSON.stringify({ root_dir: rootDir, path: absolutePath }),
    ]);
    const registryResult = await runGroundwork([
      "provenance",
      "run",
      JSON.stringify({
        root_dir: rootDir,
        tool: "gw_file_state",
        args: { path: absolutePath },
      }),
    ]);
    expect(directResult.exitCode).toBe(0);
    expect(registryResult.exitCode).toBe(0);
    const directData = (parseJson(directResult.stdout) as { data: Record<string, unknown> }).data;
    const registryData = (parseJson(registryResult.stdout) as { data: { data: Record<string, unknown> } })
      .data.data;

    expect(directData.requestedPath).toBe(packagePath);
    expect(registryData.requestedPath).toBe(packagePath);
    expect(directData.resolvedPath).toBe(registryData.resolvedPath);
    expect(directData.comparisons).toEqual(registryData.comparisons);
  });

  it("runs full provenance registry tools through direct CLI commands", async () => {
    const rootDir = await createProvenanceFixtureRepo();
    const result = await runGroundwork([
      "provenance",
      "worktree-overview",
      JSON.stringify({ root_dir: rootDir, limit: 1 }),
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

  it("reports unsupported repo-state modes through provenance run", async () => {
    const result = await runGroundwork([
      "provenance",
      "run",
      JSON.stringify({
        tool: "gw_repo_state",
        args: { mode: "remote" },
      }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(parseJson(result.stdout)).toMatchObject({
      ok: true,
      command: "provenance run",
      data: {
        ok: false,
        summary: "Unsupported provenance mode 'remote' for gw_repo_state.",
        meta: {
          tool: "gw_repo_state",
          mode: "remote",
          confidence: "unknown",
          ambiguity: "high",
        },
        error: {
          code: "MODE_NOT_SUPPORTED",
          message: "gw_repo_state currently supports only local mode.",
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
    const rootDir = await createProvenanceFixtureRepo();
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
        JSON.stringify({ ...testCase.args, root_dir: rootDir }),
      ]);
      expect(cliResult.exitCode).toBe(0);
      expect(cliResult.stderr).toBe("");
      const cliOutput = parseJson(cliResult.stdout) as { data: unknown };
      await expect(runRegistryProvenanceTool(testCase.tool, testCase.args, rootDir)).resolves.toEqual(
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
    const sessionId = "agent-session-1";

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

    const summaryResult = await runGroundwork([
      "session",
      "get",
      JSON.stringify({
        root_dir: rootDir,
        session_id: sessionId,
        view: "summary",
      }),
    ]);
    const summary = parseJson(summaryResult.stdout) as {
      data: { state?: unknown; summary?: Record<string, unknown> };
    };
    expect(summary).toMatchObject({
      ok: true,
      command: "session get",
      data: {
        view: "summary",
        summary: {
          schema_version: "groundwork-session-artifacts/v1",
          confirmed_skills: ["groundwork", "policy"],
          overrides: 1,
          active_locks: 0,
          pending_tools: 1,
          actions: 1,
        },
      },
    });
    expect(summary.data.state).toBeUndefined();

    const sessionDirs = await fs.readdir(path.join(rootDir, ".groundwork", "sessions"));
    expect(sessionDirs).toHaveLength(1);
    const sessionDir = path.join(rootDir, ".groundwork", "sessions", sessionDirs[0] ?? "");
    await expect(fs.readFile(path.join(sessionDir, "events.jsonl"), "utf8")).resolves.toContain(
      "skill-loaded",
    );
    await expect(fs.access(path.join(sessionDir, "traces.jsonl"))).rejects.toMatchObject({
      code: "ENOENT",
    });

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
      JSON.stringify({ root_dir: rootDir, session_id: sessionId, skills: ["release-readiness"] }),
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
          confirmed_skills: ["release-readiness"],
          overrides: [expect.objectContaining({ reason: "approved" })],
	          active_locks: [expect.objectContaining({ reason: "infra needs override" })],
	          context_reminders: [expect.objectContaining({ path: expect.stringContaining("AGENTS.md") })],
	        },
        text: expect.stringContaining("Confirmed skills: release-readiness"),
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
      JSON.stringify({ root_dir: rootDir, session_id: sessionId, skills: ["release-readiness"] }),
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
skills = ["release-readiness"]
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

  it("dedupes inject prompt policy messages across repeated evaluations", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-inject-"));
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
      `version = 1

[[rules]]
id = "inject-guidance"
match = ["src/**"]

[[rules.actions]]
type = "inject_prompt"
text = "Use the repository policy checklist."
`,
      "utf8",
    );

    const first = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "inject-session",
        tool: "edit",
        call_id: "inject-1",
        args: { filePath: "src/main.ts" },
      }),
    ]);
    expect(first.exitCode).toBe(0);
    expect(parseJson(first.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "allow",
        messages: [
          expect.objectContaining({
            rule_id: "inject-guidance",
            action_type: "inject_prompt",
            text: "[groundwork:policy] Use the repository policy checklist.",
          }),
        ],
      },
    });

    const second = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "inject-session",
        tool: "edit",
        call_id: "inject-2",
        args: { filePath: "src/main.ts" },
      }),
    ]);
    expect(second.exitCode).toBe(0);
    expect(parseJson(second.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "allow",
        messages: [],
        violations: [],
      },
    });
  }, 30_000);

  it("records warn-only human override state without locking mutating tools", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-warn-override-"));
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
      `version = 1

[[rules]]
id = "warn-human-override"
match = ["ops/**"]
severity = "warn"

[[rules.actions]]
type = "require_human_override"
message = "operator review recommended"
`,
      "utf8",
    );

    const warned = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "warn-override-session",
        tool: "edit",
        call_id: "warn-human-1",
        args: { filePath: "ops/deploy.yml" },
      }),
    ]);
    expect(warned.exitCode).toBe(0);
    expect(parseJson(warned.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "warn",
        violations: [
          expect.objectContaining({
            rule_id: "warn-human-override",
            action_type: "require_human_override",
            severity: "warn",
            blocking: false,
            text: "operator review recommended",
          }),
        ],
      },
    });

    const allowedAfterWarn = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "warn-override-session",
        tool: "write",
        call_id: "warn-human-2",
        args: { filePath: "README.md" },
      }),
    ]);
    expect(parseJson(allowedAfterWarn.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "allow",
        messages: [],
        violations: [],
      },
    });

    expect((await fs.readdir(rootDir)).sort()).toEqual([".groundwork", "groundwork.toml"]);
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

[[rules]]
id = "warn-review"
match = ["src/warn.ts"]
severity = "warn"

[[rules.actions]]
type = "block_tool"
message = "warning-only edits should still retain a pending snapshot"
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
    const blockedResult = await runGroundwork([
      "policy",
      "evaluate-tool-result",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        call_id: "override-1",
      }),
    ]);
    expect(parseJson(blockedResult.stdout)).toMatchObject({
      ok: true,
      command: "policy evaluate-tool-result",
      data: {
        decision: "allow",
        messages: [
          expect.objectContaining({
            text: expect.stringContaining("No pending tool snapshot"),
          }),
        ],
      },
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
    const lockedResult = await runGroundwork([
      "policy",
      "evaluate-tool-result",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        call_id: "override-2",
      }),
    ]);
    expect(parseJson(lockedResult.stdout)).toMatchObject({
      data: {
        decision: "allow",
        messages: [
          expect.objectContaining({
            text: expect.stringContaining("No pending tool snapshot"),
          }),
        ],
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

    await fs.writeFile(path.join(rootDir, "src", "warn.ts"), "const before = true;\n", "utf8");
    const warnPatchText = `*** Begin Patch
*** Update File: src/warn.ts
@@
-const before = true;
+debugger;
*** End Patch
`;
    const warnBefore = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        tool: "edit",
        call_id: "warn-1",
        args: { filePath: "src/warn.ts", patchText: warnPatchText },
      }),
    ]);
    expect(parseJson(warnBefore.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "warn",
        violations: [expect.objectContaining({ rule_id: "warn-review" })],
      },
    });
    await fs.writeFile(path.join(rootDir, "src", "warn.ts"), "debugger;\n", "utf8");

    const warnAfter = await runGroundwork([
      "policy",
      "evaluate-tool-result",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-session",
        call_id: "warn-1",
      }),
    ]);
    expect(parseJson(warnAfter.stdout)).toMatchObject({
      ok: true,
      command: "policy evaluate-tool-result",
      data: {
        decision: "allow",
        messages: [],
        violations: [],
      },
    });
  }, 120_000);

  it("keeps policy overrides as one-shot lock clears instead of durable approvals", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-override-"));
    await fs.writeFile(
      path.join(rootDir, "groundwork.toml"),
      `version = 1

[[rules]]
id = "human-override-required"
match = ["infra/prod/**"]

[[rules.actions]]
type = "require_human_override"
`,
      "utf8",
    );

    const firstBlocked = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-semantics",
        tool: "edit",
        call_id: "override-before",
        args: { filePath: "infra/prod/main.tf" },
      }),
    ]);
    expect(parseJson(firstBlocked.stdout)).toMatchObject({
      ok: true,
      data: { decision: "block" },
    });

    const override = await runGroundwork([
      "policy",
      "override",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-semantics",
        reason: "human reviewed",
      }),
    ]);
    expect(parseJson(override.stdout)).toMatchObject({
      ok: true,
      data: {
        accepted: true,
        semantics: {
          kind: "one_shot_pending_lock_clear",
          cleared_pending_lock: true,
          durable_approval: false,
          ttl: null,
          scope: "pending_override_lock",
        },
      },
    });

    const secondBlocked = await runGroundwork([
      "policy",
      "evaluate-tool-call",
      JSON.stringify({
        root_dir: rootDir,
        session_id: "override-semantics",
        tool: "edit",
        call_id: "override-after",
        args: { filePath: "infra/prod/vars.tf" },
      }),
    ]);
    expect(parseJson(secondBlocked.stdout)).toMatchObject({
      ok: true,
      data: {
        decision: "block",
        violations: [
          expect.objectContaining({
            rule_id: "human-override-required",
          }),
        ],
      },
    });
  });

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
