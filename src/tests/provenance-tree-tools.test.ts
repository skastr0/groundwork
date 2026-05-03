import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PROCESS_RUNNER,
  type ProcessCommand,
  type ProcessRunnerCarrier,
} from "../../shared/effect-runtime.ts";
import { z } from "zod";
import type { Shell } from "../provenance/tooling/state/index.ts";

vi.mock("@opencode-ai/plugin", () => {
  const mockTool = ((input: unknown) => input) as {
    (input: unknown): unknown;
    schema: typeof z;
  };
  mockTool.schema = z;
  return {
    tool: mockTool,
  };
});

const HEAD_HASH = "abcdef1234567890abcdef1234567890abcdef12";
const TOOLING_ROOT_PATH = path.join("plugin", "groundwork", "provenance", "tooling");
const TOOLING_ROOT_POSIX = "plugin/groundwork/provenance/tooling";
const TREE_TOOLS_FILE = `${TOOLING_ROOT_POSIX}/expand/tree-tools.ts`;
const STATE_FILE = `${TOOLING_ROOT_POSIX}/state/index.ts`;
const QUERY_FILE = `${TOOLING_ROOT_POSIX}/query/index.ts`;
const TOOLING_TEST_FILE = `${TOOLING_ROOT_POSIX}/tests/worktree-overview.test.ts`;

function makeShellStub(
  responses: Array<[pattern: string, output: string]>,
  options: { commandLog?: string[] } = {},
) {
  const executeCommand = (command: string): Promise<string> => {
    options.commandLog?.push(command);

    for (const [pattern, output] of responses) {
      if (command.includes(pattern)) {
        return Promise.resolve(output);
      }
    }

    return Promise.resolve("");
  };

  const shell = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    let command = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      command += String(values[index]) + (strings[index + 1] ?? "");
    }

    return {
      text: () => executeCommand(command),
    };
  }) as Shell & ProcessRunnerCarrier;

  shell.braces = (_pattern: string) => [];
  shell.escape = (input: string) => input;
  shell.env = () => shell;
  shell.cwd = () => shell;
  shell.nothrow = () => shell;
  shell.throws = () => shell;
  shell[PROCESS_RUNNER] = async ({
    cmd,
  }: {
    cmd: ProcessCommand;
    timeoutMs: number;
    maxOutputBytes: number;
    cwd?: string;
  }) => executeCommand(cmd.join(" "));

  return shell;
}

describe("tree provenance tools", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prov-tree-tools-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!tempRoot) return;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("expands a directory anchor into bounded focus areas, commits, and linked evidence", async () => {
    await fs.mkdir(path.join(tempRoot, TOOLING_ROOT_PATH, "expand"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempRoot, TOOLING_ROOT_PATH, "state"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempRoot, TOOLING_ROOT_PATH, "query"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".agents", "sdlc", "building"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, TOOLING_ROOT_PATH, "expand", "tree-tools.ts"),
      "export const tree = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, TOOLING_ROOT_PATH, "state", "index.ts"),
      "export const state = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, TOOLING_ROOT_PATH, "query", "index.ts"),
      "export const query = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T10-00-00Z-build.json"),
      JSON.stringify(
        {
          from: "builder",
          phase: "build",
          type: "implementation",
          content: {
            summary: `Touched ${TREE_TOOLS_FILE} while refining the tree view.`,
          },
          metadata: {
            timestamp: "2026-05-30T10:00:00Z",
            schema_id: "sdlc-core/implementation/v1",
            work_item_ref: {
              plugin: "sdlc-core",
              id: "tree-tool-item",
              path: ".agents/sdlc/building/tree-tool-item.md",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "sdlc", "building", "tree-tool-item.md"),
      [
        "# Tree Tool Item",
        "",
        "id: tree-tool-item",
        "",
        "## Context",
        `Update ${STATE_FILE} and ${QUERY_FILE}.`,
      ].join("\n"),
      "utf8",
    );

    const shell = makeShellStub([
      [
        `git diff --find-renames --unified=0 origin/main..HEAD -- ${TOOLING_ROOT_POSIX}`,
        [
          `diff --git a/${TREE_TOOLS_FILE} b/${TREE_TOOLS_FILE}`,
          `--- a/${TREE_TOOLS_FILE}`,
          `+++ b/${TREE_TOOLS_FILE}`,
          "@@ -1 +1,2 @@",
          "-export const tree = false;",
          "+export const tree = true;",
          "+export const moreTree = true;",
          `diff --git a/${STATE_FILE} b/${STATE_FILE}`,
          `--- a/${STATE_FILE}`,
          `+++ b/${STATE_FILE}`,
          "@@ -1 +1 @@",
          "-export const state = false;",
          "+export const state = true;",
          `diff --git a/${QUERY_FILE} b/${QUERY_FILE}`,
          `--- a/${QUERY_FILE}`,
          `+++ b/${QUERY_FILE}`,
          "@@ -1 +1,2 @@",
          "-export const query = false;",
          "+export const query = true;",
          "+export const queryMore = true;",
        ].join("\n"),
      ],
      [
        `git log -n 2 --format=%H%x1f%h%x1f%an%x1f%aI%x1f%s origin/main..HEAD -- ${TOOLING_ROOT_POSIX}`,
        [
          "1111111111111111111111111111111111111111\u001f1111111\u001fAda\u001f2026-05-30T09:00:00Z\u001fAdd tree summaries",
          "2222222222222222222222222222222222222222\u001f2222222\u001fGrace\u001f2026-05-30T08:00:00Z\u001fTighten file filters",
        ].join("\n"),
      ],
      [`git rev-list --count origin/main..HEAD -- ${TOOLING_ROOT_POSIX}`, "3"],
      ["git branch --show-current", "feature/tree"],
      ["git branch -r", "origin/main\norigin/feature/tree"],
      ["git config --get branch.feature/tree.merge", "refs/heads/main"],
      ["git config --get branch.feature/tree.remote", "origin"],
      ["git rev-parse --verify HEAD", HEAD_HASH],
      ["git symbolic-ref refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
      ["git rev-parse --verify origin/main", "abc123"],
      ["git status --porcelain", ""],
      ["git ls-files --others --exclude-standard", ""],
    ]);

    const { createTreeExpandTool } = await import("../provenance/tooling/expand/tree-tools.ts");
    const toolDef = createTreeExpandTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        path: TOOLING_ROOT_POSIX,
        scope: "branch",
        limit: 2,
        max_items: 5,
        max_bytes: 4000,
        max_depth: 1,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.anchor).toMatchObject({
      resolvedPath: TOOLING_ROOT_POSIX,
      kind: "directory",
    });
    expect(result.data.scope).toMatchObject({
      type: "branch",
      baseRef: "origin/main",
    });
    expect(result.data.summary).toMatchObject({
      changedFiles: 3,
      areas: 3,
      commits: 3,
    });
    expect(result.data.bounds.areas).toMatchObject({
      returned: 2,
      truncated: true,
    });
    expect(result.data.bounds.files).toMatchObject({
      returned: 2,
      truncated: true,
    });
    expect(result.data.commits.bounds).toMatchObject({
      returned: 2,
      truncated: true,
    });
    expect(result.data.evidence.items.map((item: { kind: string }) => item.kind)).toEqual(
      expect.arrayContaining(["message", "work_item"]),
    );
    expect(result.meta.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "TREE_AREAS_TRUNCATED" }),
        expect.objectContaining({ code: "TREE_FILES_TRUNCATED" }),
        expect.objectContaining({ code: "TREE_COMMITS_TRUNCATED" }),
      ]),
    );
  });

  it("summarizes current worktree focus areas with staged, unstaged, and untracked counts", async () => {
    await fs.mkdir(path.join(tempRoot, TOOLING_ROOT_PATH, "expand"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempRoot, TOOLING_ROOT_PATH, "state"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempRoot, TOOLING_ROOT_PATH, "tests"), {
      recursive: true,
    });
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, TOOLING_ROOT_PATH, "expand", "tree-tools.ts"),
      "export const expand = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, TOOLING_ROOT_PATH, "state", "index.ts"),
      "export const state = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, TOOLING_ROOT_PATH, "tests", "worktree-overview.test.ts"),
      "export const created = true;\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T11-00-00Z-build.json"),
      JSON.stringify(
        {
          from: "builder",
          phase: "build",
          type: "implementation",
          content: {
            summary: `Adjusted ${TREE_TOOLS_FILE} for worktree overview.`,
          },
          metadata: {
            timestamp: "2026-05-30T11:00:00Z",
            schema_id: "sdlc-core/implementation/v1",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T11-30-00Z-review.json"),
      JSON.stringify(
        {
          from: "reviewer",
          phase: "review",
          type: "findings",
          content: {
            summary: `Structured worktree assessment for ${STATE_FILE}.`,
            findings: [
              {
                file: STATE_FILE,
              },
            ],
          },
          metadata: {
            timestamp: "2026-05-30T11:30:00Z",
            schema_id: "sdlc-core/review-findings/v1",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const shell = makeShellStub([
      [
        "git diff --cached --find-renames --unified=0 -- .",
        [
          `diff --git a/${STATE_FILE} b/${STATE_FILE}`,
          "new file mode 100644",
          "--- /dev/null",
          `+++ b/${STATE_FILE}`,
          "@@ -0,0 +1 @@",
          "+export const state = true;",
        ].join("\n"),
      ],
      [
        "git diff --find-renames --unified=0 -- .",
        [
          `diff --git a/${TREE_TOOLS_FILE} b/${TREE_TOOLS_FILE}`,
          `--- a/${TREE_TOOLS_FILE}`,
          `+++ b/${TREE_TOOLS_FILE}`,
          "@@ -1 +1 @@",
          "-export const expand = false;",
          "+export const expand = true;",
        ].join("\n"),
      ],
      [
        "git log -n 3 --format=%H%x1f%h%x1f%an%x1f%aI%x1f%s origin/main..HEAD -- .",
        "3333333333333333333333333333333333333333\u001f3333333\u001fLin\u001f2026-05-30T10:30:00Z\u001fShape worktree overview",
      ],
      ["git rev-list --count origin/main..HEAD -- .", "1"],
      ["git branch --show-current", "feature/worktree"],
      ["git branch -r", "origin/main\norigin/feature/worktree"],
      ["git config --get branch.feature/worktree.merge", "refs/heads/main"],
      ["git config --get branch.feature/worktree.remote", "origin"],
      ["git rev-parse --verify HEAD", HEAD_HASH],
      ["git symbolic-ref refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
      ["git rev-parse --verify origin/main", "abc123"],
      [
        "git status --porcelain",
        [` M ${TREE_TOOLS_FILE}`, `A  ${STATE_FILE}`, `?? ${TOOLING_TEST_FILE}`].join("\n"),
      ],
      ["git ls-files --others --exclude-standard -- .", TOOLING_TEST_FILE],
      ["git ls-files --others --exclude-standard", TOOLING_TEST_FILE],
    ]);

    const { createWorktreeOverviewTool } =
      await import("../provenance/tooling/expand/tree-tools.ts");
    const toolDef = createWorktreeOverviewTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        scope: "working_tree",
        limit: 3,
        max_items: 5,
        max_bytes: 4000,
        max_depth: 3,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.scope).toMatchObject({
      type: "working_tree",
      baseRef: "origin/main",
    });
    expect(result.data.summary).toMatchObject({
      changedFiles: 3,
      focusAreas: 1,
      commits: 1,
      checkout: {
        staged: 1,
        unstaged: 1,
        untracked: 1,
      },
    });
    expect(result.data.focusAreas.map((area: { path: string }) => area.path)).toEqual([
      "plugin/groundwork/provenance",
    ]);
    expect(result.data.files.map((file: { matchedPath: string }) => file.matchedPath)).toEqual([
      TREE_TOOLS_FILE,
      STATE_FILE,
      TOOLING_TEST_FILE,
    ]);
    expect(result.data.evidence.items.length).toBeGreaterThan(0);
    expect(
      result.data.evidence.items.some(
        (item: { kind: string; detail?: string }) =>
          item.kind === "message" &&
          item.detail === `Structured worktree assessment for ${STATE_FILE}.`,
      ),
    ).toBe(true);
  });
});
