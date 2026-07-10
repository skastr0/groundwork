import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

const packageDirs = [".", "packages/core"] as const;

interface CommandResult {
  stdout: string;
  stderr: string;
}

async function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    input?: string;
  },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          [
            `${command} ${args.join(" ")} exited with ${code ?? "unknown"}`,
            stdout.trim(),
            stderr.trim(),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    });

    if (options.input !== undefined) {
      child.stdin.end(options.input);
    } else {
      child.stdin.end();
    }
  });
}

async function packPackage(packageDir: string, destination: string): Promise<string> {
  const result = await runCommand("npm", ["pack", "--json", "--pack-destination", destination], {
    cwd: path.join(repoRoot, packageDir),
  });
  const packed = JSON.parse(result.stdout) as Array<{ filename: string }>;
  const filename = packed[0]?.filename;
  if (!filename) {
    throw new Error(`npm pack did not report a filename for ${packageDir}`);
  }

  return path.isAbsolute(filename) ? filename : path.join(destination, filename);
}

async function smokeHookCli(consumerDir: string): Promise<void> {
  const result = await runCommand(
    "bun",
    [
      "node_modules/@skastr0/groundwork/dist/cli.js",
      "hook",
      "session-start",
      "{}",
    ],
    { cwd: consumerDir },
  );
  const output = JSON.parse(result.stdout) as {
    ok?: boolean;
    data?: { decision?: string; additionalContext?: string };
  };
  if (!output.ok || output.data?.decision !== "continue") {
    throw new Error("Hook CLI smoke did not return portable session-start continue");
  }
  if (!output.data?.additionalContext?.includes("Groundwork is active")) {
    throw new Error("Hook CLI smoke missing session guidance");
  }
}

async function main(): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "groundwork-pack-smoke."));
  const tarballDir = path.join(tempDir, "tarballs");
  const consumerDir = path.join(tempDir, "consumer");

  try {
    await mkdir(tarballDir, { recursive: true });
    await mkdir(consumerDir, { recursive: true });

    const tarballs: string[] = [];
    for (const packageDir of packageDirs) {
      tarballs.push(await packPackage(packageDir, tarballDir));
    }

    await runCommand("npm", ["init", "-y"], { cwd: consumerDir });
    await runCommand("npm", ["install", "--ignore-scripts", ...tarballs], {
      cwd: consumerDir,
    });

    await runCommand("bun", ["node_modules/@skastr0/groundwork/dist/cli.js", "doctor"], {
      cwd: consumerDir,
    });
    await runCommand(
      "node",
      [
        "--input-type=module",
        "-e",
        [
          "await import('@skastr0/groundwork-core');",
          "await import('@skastr0/groundwork-core/cli-support');",
          "await import('@skastr0/groundwork-core/portable');",
        ].join(" "),
      ],
      { cwd: consumerDir },
    );
    await smokeHookCli(consumerDir);

    console.log("Packed package install smoke passed.");
  } finally {
    if (process.env.GROUNDWORK_KEEP_PACK_SMOKE !== "1") {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

await main();
