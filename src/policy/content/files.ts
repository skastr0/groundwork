import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { readFileResultEffect } from "../../../shared/effect-runtime.ts";
import type { GuardrailMatcherSnippet, MatcherProcessOutput } from "./types.ts";

export function readFileTextEffect(filePath: string): Effect.Effect<string | null, never> {
  return readFileResultEffect(filePath).pipe(
    Effect.map((result) => (result.status === "available" ? result.content : null)),
  );
}

export async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function resolveConfigPath(rootDir: string, rawPath: string): string {
  if (rawPath.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) {
      return rawPath;
    }

    return path.join(home, rawPath.slice(2));
  }

  if (path.isAbsolute(rawPath)) {
    return rawPath;
  }

  return path.resolve(rootDir, rawPath);
}

export async function runMatcherCliAgainstSource(params: {
  filePath: string;
  snippet?: GuardrailMatcherSnippet;
  run: (sourcePath: string) => Promise<MatcherProcessOutput>;
}): Promise<MatcherProcessOutput> {
  const { filePath, snippet, run } = params;
  if (!snippet) {
    return run(filePath);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-snippet-"));
  const tempFilePath = path.join(tempDir, path.basename(filePath));

  try {
    await fs.writeFile(tempFilePath, snippet.content, "utf8");
    return await run(tempFilePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function spawnProcess(params: {
  cmd: string[];
  stdinText?: string;
}): Promise<MatcherProcessOutput> {
  const [command, ...args] = params.cmd;
  if (!command) {
    throw new Error("Missing command");
  }

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    const child = spawn(command, args, {
      stdio: [params.stdinText === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });

    if (params.stdinText !== undefined && child.stdin) {
      child.stdin.setDefaultEncoding("utf8");
      child.stdin.end(params.stdinText);
    }

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
