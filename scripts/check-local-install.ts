#!/usr/bin/env bun

import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

const platformArch = detectPlatform();
const standaloneBinary = join(REPO_ROOT, "dist", `${BINARY_NAME}-${platformArch}`);
const installRoot = await mkdtemp(join(tmpdir(), "groundwork-local-install-"));
const contextRoot = await mkdtemp(join(tmpdir(), "groundwork-local-install-context-"));

try {
  await run("standalone binary doctor", [standaloneBinary, "doctor"]);

  await run("temp local install", ["bun", "scripts/install.ts"], {
    env: { INSTALL_DIR: installRoot },
  });

  const installedBinary = await realpath(join(installRoot, BINARY_NAME));
  await run("installed binary doctor", [installedBinary, "doctor"], {
    env: { PATH: "/usr/bin:/bin" },
  });

  await mkdir(join(contextRoot, "src"), { recursive: true });
  await writeFile(join(contextRoot, "AGENTS.md"), "Use installed context guidance.\n", "utf8");
  await writeFile(join(contextRoot, "README.md"), "# Installed Context\n", "utf8");
  const contextResult = await run(
    "installed binary context discover include_root",
    [
      installedBinary,
      "context",
      "discover",
      JSON.stringify({
        target_path: "README.md",
        directory: contextRoot,
        root_dir: contextRoot,
        include_root: true,
      }),
    ],
    { env: { PATH: "/usr/bin:/bin" } },
  );
  const contextData = readData(
    "installed binary context discover include_root",
    parseJson("installed binary context discover include_root", contextResult.stdout),
  );
  const contextFiles = contextData["files"];
  if (
    !Array.isArray(contextFiles) ||
    !contextFiles.some(
      (file) =>
        file &&
        typeof file === "object" &&
        (file as Record<string, unknown>)["fileName"] === "AGENTS.md" &&
        (file as Record<string, unknown>)["content"] === "Use installed context guidance.\n",
    )
  ) {
    fail("installed binary context discover did not include root AGENTS.md with include_root.");
  }

  const riskResult = await run(
    "installed binary risk evaluate-command",
    [installedBinary, "risk", "evaluate-command", JSON.stringify({ command: "git reset --hard" })],
  );
  const riskData = readData(
    "installed binary risk evaluate-command",
    parseJson("installed binary risk evaluate-command", riskResult.stdout),
  );
  if (
    riskData["decision"] !== "block" ||
    !riskData["violation"] ||
    typeof riskData["violation"] !== "object" ||
    Array.isArray(riskData["violation"])
  ) {
    fail("installed binary risk evaluate-command did not block a risky shell command.");
  }

  console.log(`Local install check passed for ${platformArch}.`);
} finally {
  await rm(installRoot, { recursive: true, force: true });
  await rm(contextRoot, { recursive: true, force: true });
}
