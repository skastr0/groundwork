import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PROCESS_RUNNER,
  type ProcessCommand,
  type ProcessRunnerCarrier,
} from "../../shared/effect-runtime.ts";
import { z } from "zod";
import {
  detectLocalBaseState,
  getCurrentBranchState,
  getHeadState,
  getIndexState,
  getUntrackedFiles,
  getWorktreeState,
  resolveLocalFileState,
  resolveLocalRepoState,
  type Shell,
} from "../provenance/tooling/state/index.ts";

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

const makeShellStub = (
  responses: Record<string, string>,
  options: {
    failOnGh?: boolean;
    commandLog?: string[];
  } = {},
) => {
  const executeCommand = (command: string): Promise<string> => {
    options.commandLog?.push(command);
    if (options.failOnGh && /(^|\s)gh(\s|$)/.test(command)) {
      return Promise.reject(new Error(`Unexpected gh command: ${command}`));
    }

    for (const [pattern, output] of Object.entries(responses)) {
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
  }) => executeCommand(cmd.join(" "));

  return shell;
};

describe("local provenance repo state helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves an explicit base and records missing upstream plus local-only ambiguity", async () => {
    const shell = makeShellStub(
      {
        "git branch --show-current": "feature/local-only",
        "git branch -r": "origin/main\norigin/develop",
        "git rev-parse --verify HEAD": HEAD_HASH,
        "git rev-parse --verify main": "abc123",
        "git status --porcelain": "",
        "git ls-files --others --exclude-standard": "",
      },
      { failOnGh: true },
    );

    const state = await resolveLocalRepoState({
      shell,
      explicitBase: "main",
    });

    expect(state.base.ref).toBe("main");
    expect(state.base.detection.kind).toBe("explicit");
    expect(state.base.confidence).toBe("high");
    expect(state.base.detectionMethod).toBe("explicit base input");
    expect(state.currentBranch.name).toBe("feature/local-only");
    expect(state.currentBranch.upstream).toBeNull();
    expect(state.currentBranch.isLocalOnly).toBe(true);
    expect(state.currentBranch.confidence).toBe("medium");
    expect(state.head).toEqual({
      ref: "HEAD",
      commit: HEAD_HASH,
      shortCommit: HEAD_HASH.slice(0, 12),
      detached: false,
      branchName: "feature/local-only",
      confidence: "high",
      detectionMethod: "git rev-parse --verify HEAD",
    });
    expect(state.confidence).toBe("medium");
    expect(state.ambiguity.level).toBe("medium");
    expect(state.ambiguity.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["missing_upstream", "local_only_branch"]),
    );
  });

  it("infers the base from local remote HEAD without invoking gh", async () => {
    const commandLog: string[] = [];
    const shell = makeShellStub(
      {
        "git branch --show-current": "feature/inferred-base",
        "git branch -r": "origin/main\norigin/feature/inferred-base",
        "git config --get branch.feature/inferred-base.merge": "refs/heads/main",
        "git config --get branch.feature/inferred-base.remote": "origin",
        "git rev-parse --verify HEAD": HEAD_HASH,
        "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main",
        "git rev-parse --verify origin/main": "abc123",
        "git status --porcelain": "",
        "git ls-files --others --exclude-standard": "",
      },
      {
        failOnGh: true,
        commandLog,
      },
    );

    const currentBranch = await getCurrentBranchState(shell);
    const base = await detectLocalBaseState({ shell, currentBranch });
    const head = await getHeadState(shell, currentBranch);

    expect(currentBranch.upstream).toBe("origin/main");
    expect(currentBranch.hasMatchingRemoteBranch).toBe(true);
    expect(currentBranch.confidence).toBe("high");
    expect(base.ref).toBe("origin/main");
    expect(base.detection.kind).toBe("remote_head_symbolic_ref");
    expect(base.detection.label).toBe("local remote HEAD (symbolic-ref)");
    expect(base.confidence).toBe("medium");
    expect(base.detectionMethod).toBe("git symbolic-ref refs/remotes/origin/HEAD");
    expect(head.detached).toBe(false);
    expect(head.confidence).toBe("high");
    expect(commandLog.some((command) => /(^|\s)gh(\s|$)/.test(command))).toBe(false);
  });

  it("models detached HEAD as high ambiguity while still resolving HEAD and base refs", async () => {
    const shell = makeShellStub(
      {
        "git branch --show-current": "",
        "git branch -r": "origin/main",
        "git rev-parse --verify HEAD": HEAD_HASH,
        "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main",
        "git rev-parse --verify origin/main": "abc123",
        "git status --porcelain": "",
        "git ls-files --others --exclude-standard": "",
      },
      { failOnGh: true },
    );

    const state = await resolveLocalRepoState({ shell });

    expect(state.currentBranch).toEqual({
      name: null,
      ref: null,
      detached: true,
      upstream: null,
      hasMatchingRemoteBranch: false,
      isLocalOnly: false,
      confidence: "unknown",
      detectionMethod: "git branch --show-current + git config branch.* + git branch -r",
    });
    expect(state.head.detached).toBe(true);
    expect(state.head.branchName).toBeNull();
    expect(state.base.ref).toBe("origin/main");
    expect(state.confidence).toBe("unknown");
    expect(state.ambiguity.level).toBe("high");
    expect(state.ambiguity.issues).toContainEqual(
      expect.objectContaining({
        code: "detached_head",
        level: "high",
      }),
    );
  });

  it("separates index, worktree, and untracked file helpers for dirty checkouts", async () => {
    const shell = makeShellStub(
      {
        "git branch --show-current": "feature/dirty-state",
        "git branch -r": "origin/main\norigin/feature/dirty-state",
        "git config --get branch.feature/dirty-state.merge": "refs/heads/main",
        "git config --get branch.feature/dirty-state.remote": "origin",
        "git rev-parse --verify HEAD": HEAD_HASH,
        "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main",
        "git rev-parse --verify origin/main": "abc123",
        "git status --porcelain": [
          " M src/dirty.ts",
          "A  src/staged.ts",
          "?? src/new-file.ts",
        ].join("\n"),
        "git ls-files --others --exclude-standard": "src/new-file.ts",
      },
      { failOnGh: true },
    );

    const [index, worktree, untracked, state] = await Promise.all([
      getIndexState(shell),
      getWorktreeState(shell),
      getUntrackedFiles(shell),
      resolveLocalRepoState({ shell }),
    ]);

    expect(index).toEqual({
      ref: "index",
      dirty: true,
      count: 1,
      files: [{ status: "added", path: "src/staged.ts" }],
      confidence: "high",
      detectionMethod: "git status --porcelain",
    });
    expect(worktree).toEqual({
      ref: "worktree",
      dirty: true,
      count: 1,
      files: [{ status: "modified", path: "src/dirty.ts" }],
      confidence: "high",
      detectionMethod: "git status --porcelain",
    });
    expect(untracked).toEqual({
      ref: "worktree",
      files: ["src/new-file.ts"],
      count: 1,
      confidence: "high",
      detectionMethod: "git ls-files --others --exclude-standard",
    });
    expect(state.untracked).toEqual(untracked);
    expect(state.ambiguity.issues).toContainEqual(
      expect.objectContaining({
        code: "dirty_worktree",
        level: "low",
      }),
    );
  });

  it("resolves file paths across rename hops from base to worktree", async () => {
    const shell = makeShellStub(
      {
        "git branch --show-current": "feature/rename-chain",
        "git branch -r": "origin/main\norigin/feature/rename-chain",
        "git config --get branch.feature/rename-chain.merge": "refs/heads/main",
        "git config --get branch.feature/rename-chain.remote": "origin",
        "git rev-parse --verify HEAD": HEAD_HASH,
        "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main",
        "git rev-parse --verify origin/main": "abc123",
        "git status --porcelain": [
          "R  src/head.ts -> src/index.ts",
          " R src/index.ts -> src/worktree.ts",
        ].join("\n"),
        "git ls-files --others --exclude-standard": "",
        "git diff --name-status -M origin/main..HEAD --": "R100\tsrc/base.ts\tsrc/head.ts",
        "git diff --cached --name-status -M --": "R100\tsrc/head.ts\tsrc/index.ts",
        "git diff --name-status -M --": "R100\tsrc/index.ts\tsrc/worktree.ts",
        "git ls-tree -l origin/main -- src/base.ts":
          "100644 blob aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 12\tsrc/base.ts",
        "git ls-tree -l HEAD -- src/head.ts":
          "100644 blob bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 12\tsrc/head.ts",
        "git ls-files --stage -- src/index.ts":
          "100644 cccccccccccccccccccccccccccccccccccccccc 0\tsrc/index.ts",
      },
      { failOnGh: true },
    );

    const state = await resolveLocalFileState({
      shell,
      requestedPath: "src/worktree.ts",
    });

    expect(state.requestedPath).toBe("src/worktree.ts");
    expect(state.resolvedPath).toBe("src/worktree.ts");
    expect(state.confidence).toBe("medium");
    expect(state.ambiguity).toMatchObject({
      level: "low",
      issues: [expect.objectContaining({ code: "dirty_worktree", level: "low" })],
    });
    expect(state.base).toMatchObject({
      ref: "origin/main",
      path: "src/base.ts",
      exists: true,
      mode: "100644",
      objectId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(state.head).toMatchObject({
      ref: "HEAD",
      path: "src/head.ts",
      exists: true,
      mode: "100644",
      objectId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });
    expect(state.index).toMatchObject({
      ref: "index",
      path: "src/index.ts",
      exists: true,
      mode: "100644",
      objectId: "cccccccccccccccccccccccccccccccccccccccc",
    });
    expect(state.worktree).toMatchObject({
      ref: "worktree",
      path: "src/worktree.ts",
      exists: true,
      mode: null,
      objectId: null,
    });
    expect(state.comparisons).toEqual({
      baseToHead: {
        fromRef: "origin/main",
        toRef: "HEAD",
        fromPath: "src/base.ts",
        toPath: "src/head.ts",
        status: "renamed",
        detected: true,
        detectionMethod: "git diff --name-status -M <base-ref>..HEAD --",
      },
      headToIndex: {
        fromRef: "HEAD",
        toRef: "index",
        fromPath: "src/head.ts",
        toPath: "src/index.ts",
        status: "renamed",
        detected: true,
        detectionMethod: "git diff --cached --name-status -M --",
      },
      indexToWorktree: {
        fromRef: "index",
        toRef: "worktree",
        fromPath: "src/index.ts",
        toPath: "src/worktree.ts",
        status: "renamed",
        detected: true,
        detectionMethod: "git diff --name-status -M --",
      },
    });
  });

  it("treats an untracked file as worktree-only metadata", async () => {
    const shell = makeShellStub(
      {
        "git branch --show-current": "feature/untracked-file",
        "git branch -r": "origin/main\norigin/feature/untracked-file",
        "git config --get branch.feature/untracked-file.merge": "refs/heads/main",
        "git config --get branch.feature/untracked-file.remote": "origin",
        "git rev-parse --verify HEAD": HEAD_HASH,
        "git symbolic-ref refs/remotes/origin/HEAD": "refs/remotes/origin/main",
        "git rev-parse --verify origin/main": "abc123",
        "git status --porcelain": "?? src/new-file.ts",
        "git ls-files --others --exclude-standard": "src/new-file.ts",
        "git diff --name-status -M origin/main..HEAD --": "",
        "git diff --cached --name-status -M --": "",
        "git diff --name-status -M --": "",
      },
      { failOnGh: true },
    );

    const state = await resolveLocalFileState({
      shell,
      requestedPath: "src/new-file.ts",
    });

    expect(state.base.exists).toBe(false);
    expect(state.head.exists).toBe(false);
    expect(state.index.exists).toBe(false);
    expect(state.worktree).toMatchObject({
      ref: "worktree",
      path: "src/new-file.ts",
      exists: true,
    });
    expect(state.comparisons.indexToWorktree).toMatchObject({
      fromRef: "index",
      toRef: "worktree",
      fromPath: "src/new-file.ts",
      toPath: "src/new-file.ts",
      status: "added",
      detected: true,
    });
  });
});
