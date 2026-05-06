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
const QUERY_TOOL_PATH = "plugin/groundwork/provenance/tooling/query/index.ts";
const BLOCK_TOOL_PATH = "plugin/groundwork/provenance/tooling/query/block-target.ts";

function makeShellStub(responses: Array<[pattern: string, output: string]>) {
  const executeCommand = (command: string): Promise<string> => {
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

describe("query provenance tools", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prov-query-tools-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!tempRoot) return;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reads staged-only new files when matching message summaries are structured objects", async () => {
    await fs.mkdir(
      path.join(tempRoot, "plugin", "groundwork", "provenance", "tooling", "query"),
      {
        recursive: true,
      },
    );
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });

    await fs.writeFile(
      path.join(
        tempRoot,
        "plugin",
        "groundwork",
        "provenance",
        "tooling",
        "query",
        "index.ts",
      ),
      ["export const provenanceTools = true;", "export const loaded = true;"].join("\n") + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T12-45-00Z-review.json"),
      JSON.stringify(
        {
          from: "reviewer",
          phase: "review",
          type: "findings",
          content: {
            summary: {
              assessment: "Structured review assessment for staged provenance file.",
            },
            findings: [
              {
                file: QUERY_TOOL_PATH,
              },
            ],
          },
          metadata: {
            timestamp: "2026-05-30T12:45:00Z",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const shell = makeShellStub([
      ["git branch --show-current", "feature/prov-read"],
      ["git branch -r", "origin/main\norigin/feature/prov-read"],
      ["git config --get branch.feature/prov-read.merge", "refs/heads/main"],
      ["git config --get branch.feature/prov-read.remote", "origin"],
      ["git rev-parse --verify HEAD", HEAD_HASH],
      ["git symbolic-ref refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
      ["git rev-parse --verify origin/main", "abc123"],
      ["git status --porcelain", `A  ${QUERY_TOOL_PATH}`],
      ["git ls-files --others --exclude-standard", ""],
      ["git diff --name-status -M origin/main..HEAD --", ""],
      ["git diff --cached --name-status -M --", `A\t${QUERY_TOOL_PATH}`],
      ["git diff --name-status -M --", ""],
      [
        `git ls-files --stage -- ${QUERY_TOOL_PATH}`,
        `100644 cccccccccccccccccccccccccccccccccccccccc 0\t${QUERY_TOOL_PATH}`,
      ],
    ]);

    const tools = (await import("../provenance/tooling/query/index.ts")).createQueryTools({
      shell,
      rootDir: tempRoot,
    });
    const provReadTool = tools.gw_read;
    if (!provReadTool) {
      throw new Error("expected gw_read tool to be defined");
    }

    const raw = await provReadTool.execute(
      {
        path: QUERY_TOOL_PATH,
        layer: "worktree",
        limit: 5,
        max_items: 5,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.resolvedPath).toBe(QUERY_TOOL_PATH);
    expect(result.data.content.exists).toBe(true);
    expect(result.data.evidence.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          // Structured (non-string) content.summary falls back to a raw
          // packet artifact label instead of crashing on .trim().
          detail: `Packet artifact: 2026-05-30T12-45-00Z-review.json`,
        }),
      ]),
    );
  });

  it("reads block provenance with content window, lineage, diff, and evidence details", async () => {
    await fs.mkdir(
      path.join(tempRoot, "plugin", "groundwork", "provenance", "tooling", "query"),
      {
        recursive: true,
      },
    );
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, BLOCK_TOOL_PATH),
      ["alpha();", "const target = 1;", "const changed = target + 1;", "omega();", "tail();"].join(
        "\n",
      ) + "\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T10-00-00Z-block-review.json"),
      JSON.stringify(
        {
          from: "reviewer",
          phase: "review",
          type: "findings",
          content: {
            summary: "Block target review summary.",
            findings: [
              {
                file: BLOCK_TOOL_PATH,
              },
            ],
          },
          metadata: {
            timestamp: "2026-05-30T10:00:00Z",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const indexContent =
      ["alpha();", "const target = 0;", "const changed = target + 1;", "omega();", "tail();"].join(
        "\n",
      ) + "\n";
    const rangeCommit = [
      "fedcba9876543210fedcba9876543210fedcba98",
      "A Reviewer",
      "reviewer@example.com",
      "2026-05-30T10:00:00Z",
      "test: add block target",
    ].join("\u001f");
    const shell = makeShellStub([
      ["git branch --show-current", "feature/prov-block-read"],
      ["git branch -r", "origin/main\norigin/feature/prov-block-read"],
      ["git config --get branch.feature/prov-block-read.merge", "refs/heads/main"],
      ["git config --get branch.feature/prov-block-read.remote", "origin"],
      ["git rev-parse --verify HEAD", HEAD_HASH],
      ["git symbolic-ref refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
      ["git rev-parse --verify origin/main", "abc123"],
      ["git status --porcelain", ` M ${BLOCK_TOOL_PATH}`],
      ["git ls-files --others --exclude-standard", ""],
      ["git diff --name-status -M origin/main..HEAD --", ""],
      ["git diff --cached --name-status -M --", ""],
      ["git diff --name-status -M --", `M\t${BLOCK_TOOL_PATH}`],
      [
        `git ls-tree -l origin/main -- ${BLOCK_TOOL_PATH}`,
        `100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 80\t${BLOCK_TOOL_PATH}`,
      ],
      [
        `git ls-tree -l HEAD -- ${BLOCK_TOOL_PATH}`,
        `100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 82\t${BLOCK_TOOL_PATH}`,
      ],
      [
        `git ls-files --stage -- ${BLOCK_TOOL_PATH}`,
        `100644 cccccccccccccccccccccccccccccccccccccccc 0\t${BLOCK_TOOL_PATH}`,
      ],
      [`git show :${BLOCK_TOOL_PATH}`, indexContent],
      ["git log --no-patch", `${rangeCommit}\n`],
    ]);

    const tools = (await import("../provenance/tooling/query/index.ts")).createQueryTools({
      shell,
      rootDir: tempRoot,
    });
    const blockReadTool = tools.gw_block_read;
    if (!blockReadTool) {
      throw new Error("expected gw_block_read tool to be defined");
    }

    const raw = await blockReadTool.execute(
      {
        path: BLOCK_TOOL_PATH,
        start_line: 2,
        end_line: 3,
        radius: 1,
        limit: 5,
        max_items: 5,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.meta.tool).toBe("gw_block_read");
    expect(result.data.content).toMatchObject({
      focus: { startLine: 2, endLine: 3 },
      window: { startLine: 1, endLine: 4, source: "radius", clamped: false },
      lines: [
        { number: 1, text: "alpha();", inFocus: false },
        { number: 2, text: "const target = 1;", inFocus: true },
        { number: 3, text: "const changed = target + 1;", inFocus: true },
        { number: 4, text: "omega();", inFocus: false },
      ],
    });
    expect(result.data.lineage.data.commits.items).toEqual([
      expect.objectContaining({
        commit: "fedcba9876543210fedcba9876543210fedcba98",
        summary: "test: add block target",
      }),
    ]);
    expect(result.data.diff.comparisons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "index_to_worktree",
          detected: true,
          nearbyRanges: expect.arrayContaining([
            expect.objectContaining({
              relation: "overlap",
              distance: 0,
            }),
          ]),
        }),
      ]),
    );
    expect(result.data.evidence.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          path: ".agents/messages/2026-05-30T10-00-00Z-block-review.json",
        }),
      ]),
    );
  });
});
