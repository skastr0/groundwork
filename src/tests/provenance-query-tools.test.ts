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
import { logger } from "../provenance/tooling/utils/logger.ts";

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

function makeShellStub(responses: Array<[pattern: string, output: string | Error]>) {
  const executeCommand = (command: string): Promise<string> => {
    for (const [pattern, output] of responses) {
      if (command.includes(pattern)) {
        if (output instanceof Error) {
          return Promise.reject(output);
        }
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

  it("reads staged-only new files", async () => {
    await fs.mkdir(
      path.join(tempRoot, "plugin", "groundwork", "provenance", "tooling", "query"),
      {
        recursive: true,
      },
    );

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
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.resolvedPath).toBe(QUERY_TOOL_PATH);
    expect(result.data.content.exists).toBe(true);
    expect(result.data).not.toHaveProperty("evidence");
  });

  it("reads block provenance with content window, lineage, and diff details", async () => {
    await fs.mkdir(
      path.join(tempRoot, "plugin", "groundwork", "provenance", "tooling", "query"),
      {
        recursive: true,
      },
    );

    await fs.writeFile(
      path.join(tempRoot, BLOCK_TOOL_PATH),
      ["alpha();", "const target = 1;", "const changed = target + 1;", "omega();", "tail();"].join(
        "\n",
      ) + "\n",
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
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.meta.tool).toBe("gw_block_read");
    expect(result.meta).toMatchObject({
      mode: "local",
      confidence: "medium",
      ambiguity: "low",
      bounds: {
        limit: 4000,
        returned: expect.any(Number),
        truncated: false,
      },
    });
    expect(result.summary).toBe(
      `Read worktree block for ${BLOCK_TOOL_PATH}:2-3: 4 line(s) from 1-4, 1 nearby lineage item(s), 1 local diff range(s), repo feature/prov-block-read against origin/main.`,
    );
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "git",
          id: "content:worktree",
          path: BLOCK_TOOL_PATH,
          label: "worktree block",
        }),
        expect.objectContaining({
          kind: "git",
          path: BLOCK_TOOL_PATH,
          label: "fedcba987654",
        }),
      ]),
    );
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
    expect(result.data).not.toHaveProperty("evidence");
  });

  it("rejects unsupported block-read modes before local state loading", async () => {
    const warn = vi.spyOn(logger, "warn");
    const info = vi.spyOn(logger, "info");
    const tools = (await import("../provenance/tooling/query/index.ts")).createQueryTools({
      shell: makeShellStub([]),
      rootDir: tempRoot,
    });
    const blockReadTool = tools.gw_block_read;
    if (!blockReadTool) {
      throw new Error("expected gw_block_read tool to be defined");
    }

    for (const mode of ["remote", "hybrid"] as const) {
      const raw = await blockReadTool.execute(
        {
          path: BLOCK_TOOL_PATH,
          start_line: 1,
          end_line: 2,
          mode,
        },
        {} as never,
      );
      const result = JSON.parse(raw);

      expect(result.ok).toBe(false);
      expect(result.summary).toBe(`Unsupported provenance mode '${mode}' for gw_block_read.`);
      expect(result.meta).toMatchObject({
        tool: "gw_block_read",
        mode,
        confidence: "unknown",
        ambiguity: "high",
        warnings: [],
      });
      expect(result.error).toMatchObject({
        code: "MODE_NOT_SUPPORTED",
        message: "gw_block_read currently supports only local mode.",
      });
      expect(warn).toHaveBeenCalledWith(
        "gw_block_read unsupported mode",
        expect.objectContaining({ tool: "gw_block_read", mode }),
      );
    }
    expect(info).not.toHaveBeenCalledWith(
      "gw_block_read start",
      expect.objectContaining({ tool: "gw_block_read" }),
    );
    expect(info).not.toHaveBeenCalledWith(
      "gw_block_read end",
      expect.objectContaining({ tool: "gw_block_read" }),
    );
  });

  it("rejects block-read paths outside the worktree", async () => {
    const tools = (await import("../provenance/tooling/query/index.ts")).createQueryTools({
      shell: makeShellStub([]),
      rootDir: tempRoot,
    });
    const blockReadTool = tools.gw_block_read;
    if (!blockReadTool) {
      throw new Error("expected gw_block_read tool to be defined");
    }
    const outsidePath = path.join(path.dirname(tempRoot), "outside-block.ts");

    const raw = await blockReadTool.execute(
      {
        path: outsidePath,
        start_line: 1,
        end_line: 1,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe(`Failed to normalize path '${outsidePath}'.`);
    expect(result.meta).toMatchObject({
      tool: "gw_block_read",
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      warnings: [],
    });
    expect(result.error).toMatchObject({
      code: "GW_BLOCK_READ_PATH_INVALID",
      message: expect.stringContaining("outside worktree"),
    });
  });

  it("reports block-read range and window validation failures", async () => {
    await fs.mkdir(path.dirname(path.join(tempRoot, BLOCK_TOOL_PATH)), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, BLOCK_TOOL_PATH),
      ["alpha();", "beta();", "gamma();"].join("\n") + "\n",
      "utf8",
    );
    const tools = (await import("../provenance/tooling/query/index.ts")).createQueryTools({
      shell: makeShellStub([
        ["git branch --show-current", "feature/prov-block-read"],
        ["git branch -r", "origin/main"],
        ["git config --get branch.feature/prov-block-read.merge", ""],
        ["git config --get branch.feature/prov-block-read.remote", ""],
        ["git rev-parse --verify HEAD", HEAD_HASH],
        ["git symbolic-ref refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
        ["git rev-parse --verify origin/main", "abc123"],
        ["git status --porcelain", ""],
        ["git ls-files --others --exclude-standard", ""],
        ["git diff --name-status -M origin/main..HEAD --", ""],
        ["git diff --cached --name-status -M --", ""],
        ["git diff --name-status -M --", ""],
        [`git ls-tree -l origin/main -- ${BLOCK_TOOL_PATH}`, ""],
        [
          `git ls-tree -l HEAD -- ${BLOCK_TOOL_PATH}`,
          `100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 30\t${BLOCK_TOOL_PATH}`,
        ],
        [
          `git ls-files --stage -- ${BLOCK_TOOL_PATH}`,
          `100644 cccccccccccccccccccccccccccccccccccccccc 0\t${BLOCK_TOOL_PATH}`,
        ],
      ]),
      rootDir: tempRoot,
    });
    const blockReadTool = tools.gw_block_read;
    if (!blockReadTool) {
      throw new Error("expected gw_block_read tool to be defined");
    }

    const outOfBounds = JSON.parse(
      await blockReadTool.execute(
        {
          path: BLOCK_TOOL_PATH,
          start_line: 2,
          end_line: 4,
        },
        {} as never,
      ),
    );
    expect(outOfBounds.ok).toBe(false);
    expect(outOfBounds.summary).toBe(
      `Requested block '${BLOCK_TOOL_PATH}:2-4' is outside the selected layer.`,
    );
    expect(outOfBounds.error).toMatchObject({
      code: "BLOCK_RANGE_OUT_OF_BOUNDS",
      message: "Requested block exceeds the selected worktree layer length of 3 line(s).",
    });

    const invalidWindowCases = [
      [
        { start_line: 2, end_line: 1 },
        "end_line must be greater than or equal to start_line.",
      ],
      [
        { start_line: 1, end_line: 2, radius: 1, window_start: 1, window_end: 2 },
        "radius cannot be combined with window_start or window_end.",
      ],
      [
        { start_line: 1, end_line: 2, window_start: 1 },
        "window_start and window_end must be provided together.",
      ],
      [
        { start_line: 1, end_line: 2, window_start: 3, window_end: 2 },
        "window_end must be greater than or equal to window_start.",
      ],
      [
        { start_line: 2, end_line: 3, window_start: 1, window_end: 2 },
        "Explicit window must fully include the requested start_line and end_line.",
      ],
    ];

    for (const [input, message] of invalidWindowCases) {
      const typedInput = input as {
        start_line: number;
        end_line: number;
        radius?: number;
        window_start?: number;
        window_end?: number;
      };
      const result = JSON.parse(
        await blockReadTool.execute(
          {
            path: BLOCK_TOOL_PATH,
            ...typedInput,
          },
          {} as never,
        ),
      );

      expect(result.ok).toBe(false);
      expect(result.summary).toBe(
        `Invalid block window for '${BLOCK_TOOL_PATH}:${typedInput.start_line}-${typedInput.end_line}'.`,
      );
      expect(result.meta).toMatchObject({
        tool: "gw_block_read",
        mode: "local",
        confidence: "unknown",
        ambiguity: "high",
        warnings: [],
      });
      expect(result.error).toMatchObject({
        code: "BLOCK_WINDOW_INVALID",
        message,
      });
    }
  });

  it("returns block-read failure envelopes and logs execution failures", async () => {
    const error = vi.spyOn(logger, "error");
    const info = vi.spyOn(logger, "info");
    const tools = (await import("../provenance/tooling/query/index.ts")).createQueryTools({
      shell: makeShellStub([
        ["git branch --show-current", new Error("branch lookup failed")],
      ]),
      rootDir: tempRoot,
    });
    const blockReadTool = tools.gw_block_read;
    if (!blockReadTool) {
      throw new Error("expected gw_block_read tool to be defined");
    }

    const raw = await blockReadTool.execute(
      {
        path: BLOCK_TOOL_PATH,
        start_line: 1,
        end_line: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe(
      `Failed to read block provenance for '${BLOCK_TOOL_PATH}:1-2'.`,
    );
    expect(result.meta).toMatchObject({
      tool: "gw_block_read",
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      warnings: [],
    });
    expect(result.error).toMatchObject({
      code: "GW_BLOCK_READ_UNAVAILABLE",
      message: expect.stringContaining("branch lookup failed"),
    });
    expect(error).toHaveBeenCalledWith(
      "gw_block_read failed",
      expect.objectContaining({
        tool: "gw_block_read",
        path: BLOCK_TOOL_PATH,
        startLine: 1,
        endLine: 2,
        error: expect.stringContaining("branch lookup failed"),
      }),
    );
    expect(info).toHaveBeenCalledWith(
      "gw_block_read start",
      expect.objectContaining({ tool: "gw_block_read", path: BLOCK_TOOL_PATH }),
    );
    expect(info).not.toHaveBeenCalledWith(
      "gw_block_read end",
      expect.objectContaining({ tool: "gw_block_read" }),
    );
  });
});
