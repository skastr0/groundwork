import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverFrameworkContextFiles } from "../index.ts";

const cleanupDirs: string[] = [];

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const directory = cleanupDirs.pop();
    if (!directory) {
      continue;
    }

    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function createFixture(): Promise<{ rootDir: string; directory: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "framework-context-"));
  cleanupDirs.push(rootDir);

  const directory = path.join(rootDir, "plugin", "groundwork");
  await fs.mkdir(directory, { recursive: true });

  return { rootDir, directory };
}

async function writeText(filePath: string, text: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, text, "utf8");
}

describe("framework context discovery", () => {
  it("finds parent context files first and deeper files last", async () => {
    const { rootDir, directory } = await createFixture();
    const targetFile = path.join(rootDir, "plugin", "feature", "src", "index.ts");

    await writeText(path.join(rootDir, "AGENTS.md"), "root instructions should stay out");
    await writeText(path.join(rootDir, "plugin", "AGENTS.md"), "plugin instructions");
    await writeText(path.join(rootDir, "plugin", "feature", "CLAUDE.md"), "feature claude");
    await writeText(path.join(rootDir, "plugin", "feature", "src", "AGENTS.md"), "src agents");

    const result = await discoverFrameworkContextFiles({
      targetPath: path.relative(directory, targetFile),
      directory,
      rootDir,
    });

    expect(result).toEqual([
      {
        path: path.join(rootDir, "plugin", "AGENTS.md"),
        content: "plugin instructions",
        fileName: "AGENTS.md",
      },
      {
        path: path.join(rootDir, "plugin", "feature", "CLAUDE.md"),
        content: "feature claude",
        fileName: "CLAUDE.md",
      },
      {
        path: path.join(rootDir, "plugin", "feature", "src", "AGENTS.md"),
        content: "src agents",
        fileName: "AGENTS.md",
      },
    ]);
  });

  it("skips root-level and out-of-worktree targets", async () => {
    const { rootDir, directory } = await createFixture();

    await writeText(path.join(rootDir, "AGENTS.md"), "root instructions");
    await writeText(path.join(rootDir, "plugin", "AGENTS.md"), "plugin instructions");

    await expect(
      discoverFrameworkContextFiles({
        targetPath: path.join(rootDir, "README.md"),
        directory,
        rootDir,
      }),
    ).resolves.toEqual([]);

    await expect(
      discoverFrameworkContextFiles({
        targetPath: "../../../escape.ts",
        directory,
        rootDir,
      }),
    ).resolves.toEqual([]);
  });

  it("keeps the first matching context file per directory, even when it is empty", async () => {
    const { rootDir, directory } = await createFixture();
    const targetFile = path.join(rootDir, "plugin", "feature", "src", "index.ts");

    await writeText(path.join(rootDir, "plugin", "CLAUDE.md"), "plugin claude");
    await writeText(path.join(rootDir, "plugin", "feature", "AGENTS.md"), "");
    await writeText(
      path.join(rootDir, "plugin", "feature", "CLAUDE.md"),
      "feature claude should be ignored",
    );

    const result = await discoverFrameworkContextFiles({
      targetPath: targetFile,
      directory,
      rootDir,
    });

    expect(result).toEqual([
      {
        path: path.join(rootDir, "plugin", "CLAUDE.md"),
        content: "plugin claude",
        fileName: "CLAUDE.md",
      },
    ]);
  });
});
