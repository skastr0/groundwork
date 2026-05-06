import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  PROCESS_RUNNER,
  type ProcessCommand,
  type ProcessRunnerCarrier,
} from "../../shared/effect-runtime.ts";
import { logger } from "../provenance/tooling/utils/logger.ts";
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

type MockResponse = {
  pattern: string;
  output: string;
  shouldError?: boolean;
};

function createShellStub(responses: MockResponse[], seenCommands?: string[]) {
  const executeCommand = (command: string): Promise<string> => {
    seenCommands?.push(command);
    for (const response of responses) {
      if (command.includes(response.pattern)) {
        return response.shouldError
          ? Promise.reject(new Error(response.output))
          : Promise.resolve(response.output);
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
  shell[PROCESS_RUNNER] = async ({ cmd }: { cmd: ProcessCommand }) =>
    executeCommand(cmd.join(" "));

  return shell;
}

describe("lineage provenance tools", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prov-lineage-tools-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!tempRoot) return;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reports unsupported modes directly through gw_span_history", async () => {
    const warn = vi.spyOn(logger, "warn");
    const toolDef = await createSpanHistoryTool(createShellStub([]), tempRoot);
    const raw = await toolDef.execute(
      {
        path: "src/example.ts",
        start_line: 1,
        end_line: 2,
        mode: "remote",
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("Unsupported provenance mode 'remote' for gw_span_history.");
    expect(result.error).toMatchObject({
      code: "MODE_NOT_SUPPORTED",
      message: "gw_span_history currently supports only local mode.",
    });
    expect(warn).toHaveBeenCalledWith(
      "gw_span_history unsupported mode",
      expect.objectContaining({ mode: "remote", tool: "gw_span_history" }),
    );
  });

  it("reports invalid span ranges directly through gw_span_history", async () => {
    const toolDef = await createSpanHistoryTool(createShellStub([]), tempRoot);
    const raw = await toolDef.execute(
      {
        path: "src/example.ts",
        start_line: 4,
        end_line: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("Invalid span 'src/example.ts:4-2'.");
    expect(result.error).toMatchObject({
      code: "SPAN_RANGE_INVALID",
      message: "end_line must be greater than or equal to start_line.",
    });
  });

  it("reports path normalization failures directly through gw_span_history", async () => {
    const toolDef = await createSpanHistoryTool(createShellStub([]), tempRoot);
    const raw = await toolDef.execute(
      {
        path: path.resolve(tempRoot, "..", "outside.ts"),
        start_line: 1,
        end_line: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain("Failed to normalize path");
    expect(result.error).toMatchObject({ code: "SPAN_HISTORY_PATH_INVALID" });
    expect(result.error.message).toContain("outside worktree");
  });

  it("returns commit-backed span history and logs start/end directly through gw_span_history", async () => {
    const info = vi.spyOn(logger, "info");
    const commit =
      "abcdef1234567890abcdef1234567890abcdef12\u001fAda Lovelace\u001fada@example.com\u001f2026-05-06T12:00:00Z\u001fRefactor span history";
    const seenCommands: string[] = [];
    const toolDef = await createSpanHistoryTool(
      createShellStub([{ pattern: "git log --no-patch", output: commit }], seenCommands),
      tempRoot,
    );

    const raw = await toolDef.execute(
      {
        path: "src/example.ts",
        start_line: 1,
        end_line: 2,
        limit: 5,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      "Span history for src/example.ts:1-2: trace evidence unavailable, 1 commit history item(s), 1 contributor(s).",
    );
    expect(result.data).toMatchObject({
      requestedPath: "src/example.ts",
      resolvedPath: "src/example.ts",
      span: { startLine: 1, endLine: 2 },
      commits: {
        status: "available",
        items: [
          {
            commit: "abcdef1234567890abcdef1234567890abcdef12",
            authorName: "Ada Lovelace",
            summary: "Refactor span history",
          },
        ],
      },
    });
    expect(seenCommands.some((command) => command.includes("-L 1,2:src/example.ts"))).toBe(true);
    expect(info).toHaveBeenCalledWith(
      "gw_span_history start",
      expect.objectContaining({ path: "src/example.ts", startLine: 1, endLine: 2 }),
    );
    expect(info).toHaveBeenCalledWith(
      "gw_span_history end",
      expect.objectContaining({
        path: "src/example.ts",
        commitStatus: "available",
        lineage: 1,
      }),
    );
  });

  it("reports unavailable commit history directly through gw_span_history", async () => {
    const error = vi.spyOn(logger, "error");
    const toolDef = await createSpanHistoryTool(
      createShellStub([
        {
          pattern: "git log --no-patch",
          output: "git range failed",
          shouldError: true,
        },
      ]),
      tempRoot,
    );
    const raw = await toolDef.execute(
      {
        path: "src/example.ts",
        start_line: 1,
        end_line: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.commits).toMatchObject({
      status: "unavailable",
      code: "range_history_unavailable",
    });
    expect(result.meta.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "range_history_unavailable" }),
      ]),
    );
    expect(error).not.toHaveBeenCalledWith(
      "gw_span_history failed",
      expect.objectContaining({ path: "src/example.ts" }),
    );
  });
});

async function createSpanHistoryTool(shell: Shell, rootDir: string) {
  const tools = (await import("../provenance/tooling/lineage/index.ts")).createLineageTools({
    shell,
    rootDir,
  });
  const toolDef = tools.gw_span_history;
  if (!toolDef) {
    throw new Error("expected gw_span_history tool to be defined");
  }
  return toolDef;
}
