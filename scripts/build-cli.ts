#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DIST_DIR = join(REPO_ROOT, "dist");
const CLI_ENTRYPOINT = join(REPO_ROOT, "src", "cli.ts");
const BINARY_NAME = "groundwork";
const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
  readonly version?: string;
};
const version = packageJson.version ?? "0.0.0";

const binaryTargets = [
  { platform: "darwin", arch: "x64" },
  { platform: "darwin", arch: "arm64" },
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
] as const;

const run = async (
  label: string,
  command: ReadonlyArray<string>,
  cwd = REPO_ROOT,
): Promise<void> => {
  console.log(`\n${label}`);
  const proc = Bun.spawn([...command], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error(`${label} failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
};

console.log("Cleaning CLI binary output...");
await mkdir(DIST_DIR, { recursive: true });
for (const { platform, arch } of binaryTargets) {
  await rm(join(DIST_DIR, `${BINARY_NAME}-${platform}-${arch}`), { force: true });
}

console.log(`\nCompiling Groundwork CLI v${version} binaries...`);
for (const { platform, arch } of binaryTargets) {
  const target = `${platform}-${arch}`;
  const outfile = join(DIST_DIR, `${BINARY_NAME}-${target}`);
  console.log(`Compiling ${target}...`);
  const buildResult = await Bun.build({
    target: "bun",
    compile: {
      target: `bun-${platform}-${arch}`,
      outfile,
    },
    entrypoints: [CLI_ENTRYPOINT],
    minify: true,
  });

  if (!buildResult.success) {
    console.error(`Failed to compile ${target}`);
    for (const log of buildResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  await run(`Marking executable ${target}`, ["chmod", "+x", outfile]);
}

console.log(`
Build complete.

To install locally:
  bun run install:local
`);
