#!/usr/bin/env bun

import { mkdtemp, realpath, rm } from "node:fs/promises";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const BINARY_NAME = "groundwork";

const fail = (message: string): never => {
  console.error(message);
  process.exit(1);
};

const detectPlatform = (): string => {
  const os = platform();
  const cpu = arch();
  if (os !== "darwin" && os !== "linux") {
    fail(`Unsupported operating system: ${os}`);
  }
  if (cpu !== "x64" && cpu !== "arm64") {
    fail(`Unsupported architecture: ${cpu}`);
  }
  return `${os}-${cpu}`;
};

const run = async (
  label: string,
  command: readonly string[],
  options: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
): Promise<{ stdout: string; stderr: string }> => {
  const proc = Bun.spawn([...command], {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...options.env },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.stdin !== undefined) {
    proc.stdin.write(options.stdin);
  }
  proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    fail(`${label} failed with exit code ${exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  }
  return { stdout, stderr };
};

const parseJson = (label: string, text: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${label} did not return a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    fail(`${label} did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const readData = (label: string, parsed: Record<string, unknown>): Record<string, unknown> => {
  const data = parsed["data"];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail(`${label} response did not contain object data.`);
  }
  return data as Record<string, unknown>;
};

const expectHookCommand = (label: string, value: unknown, expected: string): void => {
  if (value !== expected) {
    fail(`${label} hook command mismatch.\nExpected: ${expected}\nReceived: ${String(value)}`);
  }
};

const platformArch = detectPlatform();
const standaloneBinary = join(REPO_ROOT, "dist", `${BINARY_NAME}-${platformArch}`);
const installRoot = await mkdtemp(join(tmpdir(), "groundwork-local-install-"));
const projectRoot = await mkdtemp(join(tmpdir(), "groundwork-local-install-project-"));

try {
  await run("standalone binary doctor", [standaloneBinary, "doctor"]);

  await run("temp local install", ["bun", "scripts/install.ts"], {
    env: { INSTALL_DIR: installRoot },
  });

  const installedBinary = await realpath(join(installRoot, BINARY_NAME));
  await run("installed binary doctor", [installedBinary, "doctor"], {
    env: { PATH: "/usr/bin:/bin" },
  });

  const installResult = await run(
    "installed binary codex install-project",
    [installedBinary, "codex", "install-project", JSON.stringify({ target_dir: projectRoot, force: true })],
  );
  const installData = readData(
    "installed binary codex install-project",
    parseJson("installed binary codex install-project", installResult.stdout),
  );
  const expectedHookCommand = `'${installedBinary}' codex hook`;
  expectHookCommand(
    "installed binary codex install-project",
    installData["hook_command"],
    expectedHookCommand,
  );

  const hookResult = await run(
    "installed binary codex hook",
    [installedBinary, "codex", "hook"],
    {
      stdin: JSON.stringify({
        hook_event_name: "PreToolUse",
        tool_name: "Bash",
        tool_input: { command: "git reset --hard" },
      }),
    },
  );
  const hookPayload = parseJson("installed binary codex hook", hookResult.stdout);
  const hookSpecificOutput = hookPayload["hookSpecificOutput"];
  if (
    !hookSpecificOutput ||
    typeof hookSpecificOutput !== "object" ||
    Array.isArray(hookSpecificOutput) ||
    (hookSpecificOutput as Record<string, unknown>)["permissionDecision"] !== "deny"
  ) {
    fail("installed binary codex hook did not deny risky Bash command.");
  }

  console.log(`Local install check passed for ${platformArch}.`);
} finally {
  await rm(installRoot, { recursive: true, force: true });
  await rm(projectRoot, { recursive: true, force: true });
}
