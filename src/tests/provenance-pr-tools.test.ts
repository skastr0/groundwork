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

type MockResponse = {
  pattern: string | RegExp;
  output: string;
  shouldError?: boolean;
};

function createShellStub(responses: MockResponse[], seenCommands?: string[]) {
  const executeCommand = (command: string): Promise<string> => {
    seenCommands?.push(command);
    const matches = responses
      .map((response, index) => ({ response, index }))
      .filter(({ response }) =>
        typeof response.pattern === "string"
          ? command.includes(response.pattern)
          : response.pattern.test(command),
      )
      .sort((left, right) => {
        const leftSpecificity =
          typeof left.response.pattern === "string" ? left.response.pattern.length : 0;
        const rightSpecificity =
          typeof right.response.pattern === "string" ? right.response.pattern.length : 0;
        return rightSpecificity - leftSpecificity || left.index - right.index;
      });

    for (const { response } of matches) {
      return response.shouldError
        ? Promise.reject(new Error(response.output))
        : Promise.resolve(response.output);
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
  }) => executeCommand(cmd.join(" "));

  return shell;
}

function createLocalRepoResponses(diffText: string): MockResponse[] {
  return [
    { pattern: "git branch --show-current", output: "feature/pr-context" },
    {
      pattern: "git branch -r",
      output: "origin/main\norigin/feature/pr-context",
    },
    { pattern: "git rev-parse --verify HEAD", output: HEAD_HASH },
    { pattern: "git rev-parse --verify origin/main", output: "abc123" },
    { pattern: "git status --porcelain", output: "" },
    { pattern: "git ls-files --others --exclude-standard", output: "" },
    {
      pattern: "git diff --find-renames --unified=0 origin/main..HEAD -- .",
      output: diffText,
    },
  ];
}

function createRemotePrResponses(prNumber: number): MockResponse[] {
  return [
    {
      pattern: `gh pr view ${prNumber} --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt`,
      output: JSON.stringify({
        number: prNumber,
        title: "Add auth provenance",
        body: "Tracks auth changes and review rationale for src/auth/login.ts.",
        url: `https://github.com/example/opencode/pull/${prNumber}`,
        state: "OPEN",
        isDraft: false,
        author: { login: "octocat" },
        baseRefName: "main",
        headRefName: "feature/pr-context",
        createdAt: "2026-05-30T12:00:00Z",
        updatedAt: "2026-05-30T12:30:00Z",
      }),
    },
    {
      pattern: `gh api --paginate repos/:owner/:repo/pulls/${prNumber}/files`,
      output: JSON.stringify([
        {
          filename: "src/auth/login.ts",
          status: "modified",
          additions: 12,
          deletions: 3,
        },
        {
          filename: "src/auth/logout.ts",
          status: "added",
          additions: 8,
          deletions: 0,
        },
      ]),
    },
    {
      pattern: `gh api --paginate repos/:owner/:repo/pulls/${prNumber}/reviews`,
      output: JSON.stringify([
        {
          id: 10,
          user: { login: "reviewer" },
          body: "Looks good overall.",
          state: "APPROVED",
          submitted_at: "2026-05-30T12:20:00Z",
        },
      ]),
    },
    {
      pattern: `gh api --paginate repos/:owner/:repo/pulls/${prNumber}/reviews/10/comments`,
      output: JSON.stringify([
        {
          id: 101,
          pull_request_review_id: 10,
          in_reply_to_id: null,
          user: { login: "reviewer" },
          body: "Please keep the login branch deterministic.",
          created_at: "2026-05-30T12:21:00Z",
          path: "src/auth/login.ts",
          line: 12,
          start_line: null,
          side: "RIGHT",
          diff_hunk: "@@ -1,2 +1,3 @@",
        },
      ]),
    },
    {
      pattern: `gh api --paginate repos/:owner/:repo/issues/${prNumber}/comments`,
      output: JSON.stringify([
        {
          id: 201,
          user: { login: "maintainer" },
          body: "Need this before release.",
          created_at: "2026-05-30T12:25:00Z",
        },
      ]),
    },
  ];
}

function createDetectedRemotePrResponses(prNumber: number): MockResponse[] {
  return [
    {
      pattern: "gh pr view --json number --jq .number",
      output: `${prNumber}\n`,
    },
    ...createRemotePrResponses(prNumber),
  ];
}

async function seedEvidenceRoot(rootDir: string) {
  await fs.mkdir(path.join(rootDir, "src", "auth"), { recursive: true });
  await fs.mkdir(path.join(rootDir, ".agents", "messages"), { recursive: true });
  await fs.mkdir(path.join(rootDir, ".agents", "sdlc", "done"), { recursive: true });

  await fs.writeFile(path.join(rootDir, "src", "auth", "login.ts"), "export const login = true;\n");
  await fs.writeFile(
    path.join(rootDir, "src", "auth", "logout.ts"),
    "export const logout = true;\n",
  );
  await fs.writeFile(
    path.join(rootDir, ".agents", "messages", "2026-05-30T12-00-00Z-build.json"),
    JSON.stringify(
      {
        from: "builder",
        phase: "build",
        type: "implementation",
        content: {
          summary: "Updated src/auth/login.ts and src/auth/logout.ts with auth provenance details.",
        },
        metadata: {
          timestamp: "2026-05-30T12:00:00Z",
          schema_id: "sdlc-core/implementation/v1",
          work_item_ref: {
            plugin: "sdlc-core",
            id: "auth-pr-context",
            path: ".agents/sdlc/done/auth-pr-context.md",
          },
        },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(rootDir, ".agents", "sdlc", "done", "auth-pr-context.md"),
    [
      "# Auth PR Context",
      "",
      "id: auth-pr-context",
      "",
      "## Context",
      "Track src/auth/login.ts and src/auth/logout.ts through review.",
      "",
      "## Acceptance Criteria",
      "- [x] Explain why src/auth/login.ts changed",
    ].join("\n"),
  );
}

describe("PR provenance tools", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prov-pr-tools-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!tempRoot) return;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("materializes explicit PR context with remote enrichment plus deterministic local branch files", async () => {
    await seedEvidenceRoot(tempRoot);
    const diffText = [
      "diff --git a/src/auth/login.ts b/src/auth/login.ts",
      "--- a/src/auth/login.ts",
      "+++ b/src/auth/login.ts",
      "@@ -1 +1,2 @@",
      "-export const login = false;",
      "+export const login = true;",
      "+export const reason = 'reviewed';",
      "diff --git a/src/auth/logout.ts b/src/auth/logout.ts",
      "--- /dev/null",
      "+++ b/src/auth/logout.ts",
      "@@ -0,0 +1 @@",
      "+export const logout = true;",
    ].join("\n");
    const shell = createShellStub([
      ...createLocalRepoResponses(diffText),
      ...createRemotePrResponses(42),
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        base: "origin/main",
        mode: "hybrid",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.meta.mode).toBe("hybrid");
    expect(result.data.remote).toMatchObject({
      status: "available",
      resolvedNumber: 42,
      confidence: "medium",
      metadata: {
        title: "Add auth provenance",
        author: "octocat",
      },
      description: {
        text: "Tracks auth changes and review rationale for src/auth/login.ts.",
        bounds: {
          requested: 4000,
          truncated: false,
        },
      },
    });
    expect(result.data.remote.files).toMatchObject({
      status: "available",
      totalFiles: 2,
    });
    expect(result.data.remote.reviewContext).toMatchObject({
      status: "available",
      counts: {
        reviews: 1,
        reviewComments: 1,
        issueComments: 1,
      },
    });
    expect(result.data.localBranch).toMatchObject({
      status: "available",
      baseRef: "origin/main",
    });
    expect(result.data.fallback.used).toBe(false);
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "review", id: "pr:42" }),
        expect.objectContaining({ kind: "git", id: "local-branch-diff" }),
      ]),
    );
  });

  it("detects the current branch PR when no explicit PR number is provided", async () => {
    await seedEvidenceRoot(tempRoot);
    const seenCommands: string[] = [];
    const shell = createShellStub(
      [
        ...createLocalRepoResponses(""),
        ...createDetectedRemotePrResponses(42),
      ],
      seenCommands,
    );

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        base: "origin/main",
        mode: "hybrid",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(seenCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("gh pr view --json number --jq .number"),
        expect.stringContaining(
          "gh pr view 42 --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
        ),
      ]),
    );
    expect(result.data.remote).toMatchObject({
      status: "available",
      attempted: true,
      requestedNumber: null,
      resolvedNumber: 42,
      detectionMethod:
        "gh pr view --json number --jq '.number' + gh pr view <pr> --json metadata + gh api pulls/<pr>/files + gh api pulls/<pr>/reviews + gh api pulls/<pr>/comments",
    });
    expect(result.data.fallback.used).toBe(false);
  });

  it("materializes PR review context when a PR has no submitted reviews", async () => {
    await seedEvidenceRoot(tempRoot);
    const shell = createShellStub([
      ...createLocalRepoResponses(""),
      {
        pattern:
          "gh pr view 42 --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
        output: JSON.stringify({
          number: 42,
          title: "No review PR",
          body: "",
          url: "https://github.com/example/opencode/pull/42",
          state: "OPEN",
          isDraft: false,
          author: { login: "octocat" },
          baseRefName: "main",
          headRefName: "feature/pr-context",
          createdAt: "2026-05-30T12:00:00Z",
          updatedAt: "2026-05-30T12:30:00Z",
        }),
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/pulls/42/files",
        output: "[]",
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/pulls/42/reviews",
        output: "[]",
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/issues/42/comments",
        output: JSON.stringify([
          {
            id: 201,
            user: { login: "maintainer" },
            body: "Needs release notes.",
            created_at: "2026-05-30T12:25:00Z",
          },
        ]),
      },
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        base: "origin/main",
        mode: "hybrid",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.remote.reviewContext).toMatchObject({
      status: "available",
      counts: {
        reviews: 0,
        reviewComments: 0,
        issueComments: 1,
      },
    });
    expect(result.data.remote.reviewContext.items).toEqual([
      expect.objectContaining({
        type: "issue_comment",
        githubId: 201,
        body: "Needs release notes.",
      }),
    ]);
  });

  it("bounds large PR review context while preserving counts", async () => {
    await seedEvidenceRoot(tempRoot);
    const longComment = "review body ".repeat(80);
    const shell = createShellStub([
      ...createLocalRepoResponses(""),
      {
        pattern:
          "gh pr view 42 --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
        output: JSON.stringify({
          number: 42,
          title: "Large review PR",
          body: "",
          url: "https://github.com/example/opencode/pull/42",
          state: "OPEN",
          isDraft: false,
          author: { login: "octocat" },
          baseRefName: "main",
          headRefName: "feature/pr-context",
          createdAt: "2026-05-30T12:00:00Z",
          updatedAt: "2026-05-30T12:30:00Z",
        }),
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/pulls/42/files",
        output: "[]",
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/pulls/42/reviews",
        output: JSON.stringify([
          {
            id: 10,
            user: { login: "reviewer" },
            body: "Please inspect details.",
            state: "COMMENTED",
            submitted_at: "2026-05-30T12:20:00Z",
          },
        ]),
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/pulls/42/reviews/10/comments",
        output: JSON.stringify([
          {
            id: 101,
            pull_request_review_id: 10,
            in_reply_to_id: null,
            user: { login: "reviewer" },
            body: longComment,
            created_at: "2026-05-30T12:21:00Z",
            path: "src/auth/login.ts",
            line: 12,
            start_line: null,
            side: "RIGHT",
            diff_hunk: "@@ -1,2 +1,3 @@",
          },
        ]),
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/issues/42/comments",
        output: "[]",
      },
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        base: "origin/main",
        mode: "hybrid",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.remote.reviewContext.counts).toMatchObject({
      reviews: 1,
      reviewComments: 1,
      issueComments: 0,
    });
    expect(result.data.remote.reviewContext.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "review_comment",
          githubId: 101,
          bodyTruncated: true,
        }),
      ]),
    );
  });

  it("surfaces missing PR remote lookup and explicit local fallback", async () => {
    await seedEvidenceRoot(tempRoot);
    const diffText = [
      "diff --git a/src/auth/login.ts b/src/auth/login.ts",
      "--- a/src/auth/login.ts",
      "+++ b/src/auth/login.ts",
      "@@ -1 +1 @@",
      "-export const login = false;",
      "+export const login = true;",
    ].join("\n");
    const shell = createShellStub([
      ...createLocalRepoResponses(diffText),
      {
        pattern: "gh pr view --json number --jq '.number'",
        output: 'no pull requests found for branch "feature/pr-context"',
        shouldError: true,
      },
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        base: "origin/main",
        mode: "hybrid",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.remote).toMatchObject({
      status: "unavailable",
      code: "PR_NOT_FOUND",
    });
    expect(result.data.localBranch).toMatchObject({
      status: "available",
      baseRef: "origin/main",
    });
    expect(result.data.fallback).toMatchObject({
      used: true,
      kind: "local_branch",
    });
    expect(result.meta.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PR_NOT_FOUND" }),
        expect.objectContaining({ code: "PR_LOCAL_FALLBACK_USED" }),
      ]),
    );
  });

  it("keeps local PR materialization on the cheap no-remote path", async () => {
    await seedEvidenceRoot(tempRoot);
    const diffText = [
      "diff --git a/src/auth/login.ts b/src/auth/login.ts",
      "--- a/src/auth/login.ts",
      "+++ b/src/auth/login.ts",
      "@@ -1 +1 @@",
      "-export const login = false;",
      "+export const login = true;",
    ].join("\n");
    const seenCommands: string[] = [];
    const shell = createShellStub(
      [
        ...createLocalRepoResponses(diffText),
        {
          pattern: /^gh /,
          output: "local mode must not invoke gh",
          shouldError: true,
        },
      ],
      seenCommands,
    );

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        base: "origin/main",
        mode: "local",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(seenCommands.some((command) => command.startsWith("gh "))).toBe(false);
    expect(result.ok).toBe(true);
    expect(result.data.remote).toMatchObject({
      status: "unsupported",
      attempted: false,
      code: "REMOTE_LOOKUP_DISABLED",
    });
    expect(result.data.localBranch).toMatchObject({
      status: "available",
      baseRef: "origin/main",
      files: [expect.objectContaining({ path: "src/auth/login.ts" })],
    });
    expect(result.data.fallback).toMatchObject({
      used: true,
      kind: "local_branch",
    });
  });

  it("fails explicitly in remote mode when gh is unauthenticated", async () => {
    const shell = createShellStub([
      {
        pattern:
          "gh pr view 42 --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
        output: "To get started with GitHub CLI, please run: gh auth login",
        shouldError: true,
      },
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        mode: "remote",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.meta.mode).toBe("remote");
    expect(result.error).toMatchObject({ code: "GH_UNAUTHENTICATED" });
  });

  it("preserves generic GitHub CLI failure envelopes", async () => {
    const shell = createShellStub([
      {
        pattern:
          "gh pr view 42 --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
        output: "GraphQL: Something went wrong",
        shouldError: true,
      },
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        mode: "remote",
        limit: 10,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "GH_REMOTE_ERROR",
      retryable: true,
    });
    expect(result.error.message).toContain("GitHub CLI request failed");
  });

  it("bounds remote PR descriptions while preserving available remote confidence", async () => {
    const shell = createShellStub([
      {
        pattern:
          "gh pr view 42 --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
        output: JSON.stringify({
          number: 42,
          title: "Long body PR",
          body: "remote description ".repeat(40),
          url: "https://github.com/example/opencode/pull/42",
          state: "OPEN",
          isDraft: false,
          author: { login: "octocat" },
          baseRefName: "main",
          headRefName: "feature/pr-context",
          createdAt: "2026-05-30T12:00:00Z",
          updatedAt: "2026-05-30T12:30:00Z",
        }),
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/pulls/42/files",
        output: JSON.stringify([
          {
            filename: "src/auth/login.ts",
            status: "modified",
            additions: 12,
            deletions: 3,
          },
        ]),
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/pulls/42/reviews",
        output: "[]",
      },
      {
        pattern: "gh api --paginate repos/:owner/:repo/issues/42/comments",
        output: "[]",
      },
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        mode: "remote",
        limit: 10,
        max_bytes: 120,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.remote).toMatchObject({
      status: "available",
      confidence: "medium",
      description: {
        bounds: {
          requested: 120,
          limit: 120,
          truncated: true,
        },
      },
    });
    expect(Buffer.byteLength(result.data.remote.description.text, "utf8")).toBeLessThanOrEqual(120);
    expect(result.meta.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "PR_DESCRIPTION_TRUNCATED" }),
      ]),
    );
  });

  it("expands PR context into linked local evidence", async () => {
    await seedEvidenceRoot(tempRoot);
    const diffText = [
      "diff --git a/src/auth/login.ts b/src/auth/login.ts",
      "--- a/src/auth/login.ts",
      "+++ b/src/auth/login.ts",
      "@@ -1 +1,2 @@",
      "-export const login = false;",
      "+export const login = true;",
      "+export const rationale = 'tracked';",
      "diff --git a/src/auth/logout.ts b/src/auth/logout.ts",
      "--- /dev/null",
      "+++ b/src/auth/logout.ts",
      "@@ -0,0 +1 @@",
      "+export const logout = true;",
    ].join("\n");
    const shell = createShellStub([
      ...createLocalRepoResponses(diffText),
      ...createRemotePrResponses(42),
    ]);

    const { createPrExpandTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrExpandTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        base: "origin/main",
        mode: "hybrid",
        limit: 10,
        max_items: 5,
        max_bytes: 4000,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.materialized.remote.status).toBe("available");
    expect(result.data.evidence.items.map((item: { kind: string }) => item.kind)).toEqual(
      expect.arrayContaining(["message", "work_item"]),
    );
    expect(result.summary).toContain("Linked");
  });

  it("fails early when remote PR metadata exceeds the pre-parse budget", async () => {
    await seedEvidenceRoot(tempRoot);
    const oversizedMetadata = "x".repeat(300_000);
    const shell = createShellStub([
      ...createLocalRepoResponses(""),
      {
        pattern:
          "gh pr view 42 --json number,title,body,url,state,isDraft,author,baseRefName,headRefName,createdAt,updatedAt",
        output: oversizedMetadata,
      },
    ]);

    const { createPrMaterializeTool } = await import("../provenance/tooling/expand/pr-tools.ts");
    const toolDef = createPrMaterializeTool({ shell, rootDir: tempRoot });
    const raw = await toolDef.execute(
      {
        pr: 42,
        mode: "remote",
      },
      {
        sessionID: "session-test",
        messageID: "message-test",
        agent: "tester",
        directory: tempRoot,
        worktree: tempRoot,
        abort: new AbortController().signal,
        metadata: () => {},
        ask: async () => {},
      },
    );

    expect(raw).toContain("Failed to materialize remote PR context for #42.");
    expect(raw).toContain("exceeded 256000 bytes");
  });
});
