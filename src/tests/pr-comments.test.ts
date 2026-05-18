import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import {
  PROCESS_RUNNER,
  type ProcessCommand,
  type ProcessRunnerCarrier,
} from "../../shared/effect-runtime.ts";
import { PRCommentsManager, type Shell } from "../../review/pr-comments.ts";
import { logger } from "../../review/utils/logger.ts";

type MockResponse = {
  pattern: string | RegExp;
  output: string | string[];
  shouldError?: boolean;
};

function createShellStub(responses: MockResponse[], seenCommands?: string[]) {
  const executeCommand = (command: string): Promise<string> => {
    seenCommands?.push(command);
    const response = responses.find((candidate) =>
      typeof candidate.pattern === "string"
        ? command.includes(candidate.pattern)
        : candidate.pattern.test(command),
    );

    if (!response) {
      return Promise.resolve("");
    }

    const output = Array.isArray(response.output)
      ? (response.output.shift() ?? "")
      : response.output;

    return response.shouldError ? Promise.reject(new Error(output)) : Promise.resolve(output);
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
  }) => executeCommand(cmd.join(" "));

  return shell;
}

function createReviewThreadPage(options: {
  nodes: unknown[];
  hasNextPage?: boolean;
  endCursor?: string | null;
}): string {
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: options.nodes,
            pageInfo: {
              hasNextPage: options.hasNextPage ?? false,
              endCursor: options.endCursor ?? null,
            },
          },
        },
      },
    },
  });
}

function createThreadCommentsPage(options: {
  nodes: Array<{ databaseId: number | null }>;
  hasNextPage?: boolean;
  endCursor?: string | null;
}): string {
  return JSON.stringify({
    data: {
      node: {
        comments: {
          nodes: options.nodes,
          pageInfo: {
            hasNextPage: options.hasNextPage ?? false,
            endCursor: options.endCursor ?? null,
          },
        },
      },
    },
  });
}

describe("PRCommentsManager", () => {
  it("maps review thread state to first-page and nested comments", async () => {
    const seenCommands: string[] = [];
    const manager = new PRCommentsManager(
      createShellStub(
        [
          {
            pattern: "pr=17",
            output: createReviewThreadPage({
              nodes: [
                {
                  id: "THREAD_1",
                  isResolved: true,
                  isCollapsed: false,
                  outdated: true,
                  resolvedBy: { login: "maintainer" },
                  comments: {
                    nodes: [{ databaseId: 101 }, { databaseId: null }],
                    pageInfo: { hasNextPage: true, endCursor: "COMMENT_CURSOR" },
                  },
                },
              ],
            }),
          },
          {
            pattern: "id=THREAD_1",
            output: createThreadCommentsPage({
              nodes: [{ databaseId: 102 }, { databaseId: null }],
            }),
          },
        ],
        seenCommands,
      ),
    );

    const result = await Effect.runPromise(manager.fetchCommentStatesViaGraphQLEffect(17));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.get(101)).toEqual({
      is_resolved: true,
      is_hidden: false,
      is_outdated: true,
      resolved_by: "maintainer",
    });
    expect(result.data.get(102)).toEqual({
      is_resolved: true,
      is_hidden: false,
      is_outdated: true,
      resolved_by: "maintainer",
    });
    expect(result.data.get(101)).not.toBe(result.data.get(102));
    expect(seenCommands.some((command) => command.includes("pr=17"))).toBe(true);
    expect(seenCommands.some((command) => command.includes("id=THREAD_1"))).toBe(true);
  });

  it("fails when review thread pagination repeats a cursor", async () => {
    const manager = new PRCommentsManager(
      createShellStub([
        {
          pattern: "pr=23",
          output: [
            createReviewThreadPage({
              nodes: [],
              hasNextPage: true,
              endCursor: "same",
            }),
            createReviewThreadPage({
              nodes: [],
              hasNextPage: true,
              endCursor: "same",
            }),
          ],
        },
      ]),
    );

    const result = await Effect.runPromise(manager.fetchCommentStatesViaGraphQLEffect(23));

    expect(result).toEqual({
      success: false,
      error: "GraphQL review thread pagination repeated cursor 'same' for PR #23.",
    });
  });

  it("fails when review thread pagination exceeds the page limit", async () => {
    const pages = Array.from({ length: 50 }, (_value, index) =>
      createReviewThreadPage({
        nodes: [],
        hasNextPage: true,
        endCursor: `cursor-${index + 1}`,
      }),
    );
    const manager = new PRCommentsManager(
      createShellStub([
        {
          pattern: "pr=41",
          output: pages,
        },
      ]),
    );

    const result = await Effect.runPromise(manager.fetchCommentStatesViaGraphQLEffect(41));

    expect(result).toEqual({
      success: false,
      error: "GraphQL review thread pagination exceeded 50 pages for PR #41.",
    });
  });

  it("returns the existing GraphQL parse failure envelope", async () => {
    let expectedError = "";
    try {
      JSON.parse("{not-json");
    } catch (error) {
      expectedError = `Failed to parse GraphQL: ${error}`;
    }
    const manager = new PRCommentsManager(
      createShellStub([{ pattern: "pr=29", output: "{not-json" }]),
    );

    const result = await Effect.runPromise(manager.fetchCommentStatesViaGraphQLEffect(29));

    expect(result).toEqual({
      success: false,
      error: expectedError,
    });
  });

  it("warns and preserves first-page states when nested comment pagination fails", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const manager = new PRCommentsManager(
      createShellStub([
        {
          pattern: "pr=31",
          output: createReviewThreadPage({
            nodes: [
              {
                id: "THREAD_2",
                isResolved: false,
                isCollapsed: true,
                outdated: false,
                resolvedBy: null,
                comments: {
                  nodes: [{ databaseId: 201 }],
                  pageInfo: { hasNextPage: true, endCursor: "COMMENT_CURSOR" },
                },
              },
            ],
          }),
        },
        {
          pattern: "id=THREAD_2",
          output: "network down",
          shouldError: true,
        },
      ]),
    );

    const result = await Effect.runPromise(manager.fetchCommentStatesViaGraphQLEffect(31));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.get(201)).toEqual({
      is_resolved: false,
      is_hidden: true,
      is_outdated: false,
      resolved_by: undefined,
    });
    expect(warn).toHaveBeenCalledWith("Failed to fetch additional thread comments", {
      thread_id: "THREAD_2",
      error: expect.stringContaining("network down"),
    });
    warn.mockRestore();
  });
});
