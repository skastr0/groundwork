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

const HEAD_HASH = "abcdef1234567890abcdef1234567890abcdef12";

type MockResponse = {
  pattern: string | RegExp;
  output: string;
  shouldError?: boolean;
};

function createShellStub(responses: MockResponse[], seenCommands?: string[]) {
  const executeCommand = (command: string): Promise<string> => {
    seenCommands?.push(command);
    for (const response of responses) {
      const matches =
        typeof response.pattern === "string"
          ? command.includes(response.pattern)
          : response.pattern.test(command);

      if (matches) {
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

function createRepoResponses(statusOutput = "", untrackedOutput = ""): MockResponse[] {
  return [
    { pattern: "git branch --show-current", output: "feature/provenance-scores" },
    {
      pattern: "git branch -r",
      output: "origin/main\norigin/feature/provenance-scores",
    },
    {
      pattern: "git config --get branch.feature/provenance-scores.merge",
      output: "refs/heads/main",
    },
    {
      pattern: "git config --get branch.feature/provenance-scores.remote",
      output: "origin",
    },
    { pattern: "git rev-parse --verify HEAD", output: HEAD_HASH },
    { pattern: "git symbolic-ref refs/remotes/origin/HEAD", output: "refs/remotes/origin/main" },
    { pattern: "git rev-parse --verify origin/main", output: "abc123" },
    { pattern: "git status --porcelain", output: statusOutput },
    { pattern: "git ls-files --others --exclude-standard", output: untrackedOutput },
    {
      pattern: "git log -1 --format=%H%x1f%aI HEAD",
      output: `${HEAD_HASH}\u001f2026-05-30T12:00:00Z`,
    },
  ];
}

function createHistoryResponses(
  targetPath: string,
  totalCount: number,
  logOutput: string,
): MockResponse[] {
  const escapedPath = targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [
    {
      pattern: new RegExp(`git rev-list --count --no-merges --since=.* HEAD -- ${escapedPath}`),
      output: String(totalCount),
    },
    {
      pattern: new RegExp(
        `git log --find-renames --no-merges --numstat -n \\d+ --since=.* --format=%H%x1f%aI%x1f%an%x1f%ae%x1f%s HEAD -- ${escapedPath}`,
      ),
      output: logOutput,
    },
  ];
}

function createSrcHistoryLog(): string {
  return [
    `1111111111111111111111111111111111111111\u001f2026-05-30T12:00:00Z\u001fAda\u001fada@example.com\u001fUpdate a and b`,
    "10\t2\tsrc/a.ts",
    "1\t1\tsrc/b.ts",
    `2222222222222222222222222222222222222222\u001f2026-05-30T12:00:00Z\u001fGrace\u001fgrace@example.com\u001fRefine a`,
    "4\t4\tsrc/a.ts",
    `3333333333333333333333333333333333333333\u001f2026-05-30T12:00:00Z\u001fAda\u001fada@example.com\u001fAdd c`,
    "20\t5\tsrc/c.ts",
  ].join("\n");
}

function createFileHistoryLog(): string {
  return [
    `1111111111111111111111111111111111111111\u001f2026-05-30T12:00:00Z\u001fAda\u001fada@example.com\u001fUpdate a`,
    "10\t2\tsrc/a.ts",
    `2222222222222222222222222222222222222222\u001f2026-05-30T12:00:00Z\u001fGrace\u001fgrace@example.com\u001fRefine a`,
    "4\t4\tsrc/a.ts",
  ].join("\n");
}

async function seedEvidenceRoot(rootDir: string) {
  await fs.mkdir(path.join(rootDir, "src"), { recursive: true });
  await fs.mkdir(path.join(rootDir, ".agents", "messages"), { recursive: true });
  await fs.mkdir(path.join(rootDir, ".agents", "sdlc", "done"), { recursive: true });

  await fs.writeFile(path.join(rootDir, "src", "a.ts"), "export const a = true;\n", "utf8");
  await fs.writeFile(path.join(rootDir, "src", "b.ts"), "export const b = true;\n", "utf8");
  await fs.writeFile(path.join(rootDir, "src", "c.ts"), "export const c = true;\n", "utf8");

  await fs.writeFile(
    path.join(rootDir, ".agents", "messages", "2026-05-30T12-10-00Z-build.json"),
    JSON.stringify(
      {
        from: "builder",
        phase: "build",
        type: "implementation",
        content: {
          summary: "Updated src/a.ts with recent provenance context.",
        },
        metadata: {
          timestamp: "2026-05-30T12:10:00Z",
          schema_id: "sdlc-core/implementation/v1",
          work_item_ref: {
            plugin: "sdlc-core",
            id: "score-evidence-item",
            path: ".agents/sdlc/done/score-evidence-item.md",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(
    path.join(rootDir, ".agents", "sdlc", "done", "score-evidence-item.md"),
    [
      "# Score Evidence Item",
      "",
      "id: score-evidence-item",
      "",
      "## Context",
      "Track src/a.ts with explicit work-item evidence.",
      "",
      "## Acceptance Criteria",
      "- [x] Explain src/a.ts changes",
    ].join("\n"),
    "utf8",
  );
}

describe("provenance score tools", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prov-score-tools-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (!tempRoot) return;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("reports highest churn and most-active hotspots across deterministic windows", async () => {
    const info = vi.spyOn(logger, "info");
    const shell = createShellStub([
      ...createRepoResponses(),
      ...createHistoryResponses("src", 3, createSrcHistoryLog()),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src",
        windows: [7, 30],
        limit: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.summary).toBe(
      "Hotspots for src: 30d top activity src/a.ts (2 commit(s)), top churn src/c.ts (25 changed line(s)).",
    );
    expect(result.meta).toMatchObject({
      tool: "gw_hotspots",
      mode: "local",
      confidence: "high",
      ambiguity: "none",
      warnings: [],
    });
    expect(result.data.anchor).toMatchObject({
      requestedPath: "src",
      resolvedPath: "src",
      groupBy: "file",
    });
    expect(result.data.windows[0]).toMatchObject({
      days: 7,
      commitCount: 2,
    });
    expect(result.data.windows[0].mostActive[0]).toMatchObject({
      path: "src/a.ts",
      commitCount: 2,
      churn: 20,
    });
    expect(result.data.windows[1].highestChurn[0]).toMatchObject({
      path: "src/c.ts",
      churn: 25,
    });
    expect(result.data.windows[1].highestChurn[0].signals[0].sourceIDs).toContain(
      "hotspots-history:src",
    );
    expect(result.sources).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "hotspots-history:src" })]),
    );
    expect(info).toHaveBeenCalledWith(
      "gw_hotspots start",
      expect.objectContaining({ tool: "gw_hotspots", path: "src" }),
    );
    expect(info).toHaveBeenCalledWith(
      "gw_hotspots end",
      expect.objectContaining({
        tool: "gw_hotspots",
        path: "src",
        windows: 2,
        totalCommits: 3,
      }),
    );
  });

  it("reports empty hotspots history through meta warnings and confidence", async () => {
    const shell = createShellStub([
      ...createRepoResponses(),
      ...createHistoryResponses("src/missing.ts", 0, ""),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src/missing.ts",
        windows: [7],
        limit: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.meta).toMatchObject({
      tool: "gw_hotspots",
      mode: "local",
      confidence: "low",
      ambiguity: "low",
      warnings: [
        expect.objectContaining({
          code: "HISTORY_EMPTY",
          message:
            "No matching non-merge commits were found for 'src/missing.ts' in the requested window.",
          ambiguity: "low",
        }),
      ],
    });
    expect(result.data.history).toMatchObject({
      totalCommits: 0,
      loadedCommits: 0,
    });
  });

  it("reports unavailable HEAD history anchors without running history windows", async () => {
    const seenCommands: string[] = [];
    const shell = createShellStub([
      { pattern: "git log -1 --format=%H%x1f%aI HEAD", output: "" },
      ...createRepoResponses(),
    ], seenCommands);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src",
        windows: [7],
        max_commits: 7,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.history).toMatchObject({
      headCommit: null,
      headAuthoredAt: null,
      headAuthoredAtMs: 0,
      oldestSince: null,
      totalCommits: 0,
      loadedCommits: 0,
      bounds: {
        requested: 7,
        limit: 7,
        returned: 0,
        truncated: false,
      },
    });
    expect(result.meta.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "HISTORY_EMPTY" })]),
    );
    expect(seenCommands).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("git rev-list --count --no-merges"),
        expect.stringContaining("git log --find-renames --no-merges --numstat"),
      ]),
    );
  });

  it("reports truncated hotspots history through meta warnings", async () => {
    const shell = createShellStub([
      ...createRepoResponses(),
      ...createHistoryResponses("src", 5, createSrcHistoryLog()),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src",
        windows: [30],
        limit: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.meta).toMatchObject({
      confidence: "medium",
      ambiguity: "low",
      warnings: [
        expect.objectContaining({
          code: "HISTORY_COMMITS_TRUNCATED",
          message: "History scan loaded 3/5 commit(s).",
          ambiguity: "low",
        }),
      ],
    });
    expect(result.data.history).toMatchObject({
      totalCommits: 5,
      loadedCommits: 3,
      bounds: expect.objectContaining({ truncated: true }),
    });
  });

  it("reports repo ambiguity warnings in hotspots metadata", async () => {
    const shell = createShellStub([
      ...createRepoResponses(" M src/a.ts", ""),
      ...createHistoryResponses("src", 3, createSrcHistoryLog()),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src",
        windows: [30],
        limit: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.meta).toMatchObject({
      ambiguity: "low",
      warnings: [
        expect.objectContaining({
          code: "dirty_worktree",
          ambiguity: "low",
          message:
            "Local index/worktree has uncommitted changes or untracked files, so provenance is relative to a dirty checkout.",
        }),
      ],
    });
  });

  it("reports unsupported hotspots modes and logs the mode rejection", async () => {
    const warn = vi.spyOn(logger, "warn");
    const info = vi.spyOn(logger, "info");
    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell: createShellStub([]), rootDir: tempRoot }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    for (const mode of ["remote", "hybrid"] as const) {
      const raw = await toolDef.execute(
        {
          path: "src",
          mode,
        },
        {} as never,
      );
      const result = JSON.parse(raw);

      expect(result.ok).toBe(false);
      expect(result.summary).toBe(`Unsupported provenance mode '${mode}' for gw_hotspots.`);
      expect(result.meta).toMatchObject({
        tool: "gw_hotspots",
        mode,
        confidence: "unknown",
        ambiguity: "high",
        warnings: [],
      });
      expect(result.error).toMatchObject({
        code: "MODE_NOT_SUPPORTED",
        message: "gw_hotspots currently supports only local mode.",
      });
      expect(warn).toHaveBeenCalledWith(
        "gw_hotspots unsupported mode",
        expect.objectContaining({ tool: "gw_hotspots", mode }),
      );
    }
    expect(info).not.toHaveBeenCalledWith(
      "gw_hotspots start",
      expect.objectContaining({ tool: "gw_hotspots" }),
    );
    expect(info).not.toHaveBeenCalledWith(
      "gw_hotspots end",
      expect.objectContaining({ tool: "gw_hotspots" }),
    );
  });

  it("returns hotspots failure envelopes and logs execution failures", async () => {
    const error = vi.spyOn(logger, "error");
    const info = vi.spyOn(logger, "info");
    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({
      shell: createShellStub([
        {
          pattern: "git branch --show-current",
          output: "branch lookup failed",
          shouldError: true,
        },
      ]),
      rootDir: tempRoot,
    }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src",
        windows: [7],
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("Failed to resolve hotspots for 'src'.");
    expect(result.meta).toMatchObject({
      tool: "gw_hotspots",
      mode: "local",
      confidence: "unknown",
      ambiguity: "high",
      warnings: [],
    });
    expect(result.error).toMatchObject({
      code: "HOTSPOTS_UNAVAILABLE",
    });
    expect(result.error.message).toContain("branch lookup failed");
    expect(error).toHaveBeenCalledWith(
      "gw_hotspots failed",
      expect.objectContaining({
        tool: "gw_hotspots",
        path: "src",
        error: expect.stringContaining("branch lookup failed"),
      }),
    );
    expect(info).toHaveBeenCalledWith(
      "gw_hotspots start",
      expect.objectContaining({ tool: "gw_hotspots", path: "src" }),
    );
    expect(info).not.toHaveBeenCalledWith(
      "gw_hotspots end",
      expect.objectContaining({ tool: "gw_hotspots" }),
    );
  });

  it("returns hotspots failure envelopes for history command failures", async () => {
    const error = vi.spyOn(logger, "error");
    const info = vi.spyOn(logger, "info");
    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({
      shell: createShellStub([
        ...createRepoResponses(),
        {
          pattern: "git rev-list --count --no-merges",
          output: "history count failed",
          shouldError: true,
        },
      ]),
      rootDir: tempRoot,
    }).gw_hotspots;
    if (!toolDef) {
      throw new Error("expected gw_hotspots tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src",
        windows: [7],
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("Failed to resolve hotspots for 'src'.");
    expect(result.error).toMatchObject({
      code: "HOTSPOTS_UNAVAILABLE",
      message: expect.stringContaining("history count failed"),
    });
    expect(error).toHaveBeenCalledWith(
      "gw_hotspots failed",
      expect.objectContaining({
        tool: "gw_hotspots",
        path: "src",
        error: expect.stringContaining("history count failed"),
      }),
    );
    expect(info).toHaveBeenCalledWith(
      "gw_hotspots start",
      expect.objectContaining({ tool: "gw_hotspots", path: "src" }),
    );
    expect(info).not.toHaveBeenCalledWith(
      "gw_hotspots end",
      expect.objectContaining({ tool: "gw_hotspots" }),
    );
  });

  it("ranks recent author authority with explicit factor breakdowns", async () => {
    const shell = createShellStub([
      ...createRepoResponses(),
      ...createHistoryResponses("src", 3, createSrcHistoryLog()),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_authority;
    if (!toolDef) {
      throw new Error("expected gw_authority tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src",
        window_days: 30,
        limit: 2,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.totals).toMatchObject({
      commits: 3,
      touchedPaths: 3,
      uniqueAuthors: 2,
      churn: 47,
    });
    expect(result.data.leaders[0].authorName).toBe("Ada");
    expect(result.data.leaders[0].score.value).toBeCloseTo(78.23, 2);
    expect(
      result.data.leaders[0].score.factors.map((factor: { key: string }) => factor.key),
    ).toEqual(["commit_share", "churn_share", "path_share"]);
    expect(
      result.data.leaders[0].score.signals.every((signal: { sourceIDs: string[] }) =>
        signal.sourceIDs.includes("authority-history:src"),
      ),
    ).toBe(true);
  });

  it("builds a stability report with cited component scores and linked evidence", async () => {
    await seedEvidenceRoot(tempRoot);
    const shell = createShellStub([
      ...createRepoResponses("MM src/a.ts", ""),
      ...createHistoryResponses("src/a.ts", 2, createFileHistoryLog()),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_stability_report;
    if (!toolDef) {
      throw new Error("expected gw_stability_report tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src/a.ts",
        recent_window_days: 7,
        baseline_window_days: 30,
        limit: 5,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.pending).toMatchObject({
      staged: 1,
      unstaged: 1,
      totalPaths: 1,
    });
    expect(result.data.evidence.rankedItems).toBeGreaterThan(0);
    expect(result.data.scores.ownershipClarity.value).toBe(50);
    expect(result.data.scores.recentChangePressure.value).toBe(100);
    expect(result.data.scores.pendingChangePressure.value).toBe(100);
    expect(
      result.data.scores.stability.factors.map((factor: { key: string }) => factor.key),
    ).toEqual([
      "ownership_clarity_factor",
      "evidence_coverage_factor",
      "change_calmness_factor",
      "clean_worktree_factor",
    ]);
    expect(result.data.assessment.label).toBe("volatile");
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "stability-history:src/a.ts" }),
        expect.objectContaining({ id: "evidence:src/a.ts" }),
        expect.objectContaining({ kind: "message" }),
        expect.objectContaining({ kind: "work_item" }),
      ]),
    );
  });

  it("builds a stability report for empty history without evidence", async () => {
    const shell = createShellStub([
      ...createRepoResponses("", ""),
      ...createHistoryResponses("src/missing.ts", 0, ""),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_stability_report;
    if (!toolDef) {
      throw new Error("expected gw_stability_report tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src/missing.ts",
        recent_window_days: 30,
        baseline_window_days: 7,
        limit: 3,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.anchor).toEqual({
      requestedPath: "src/missing.ts",
      resolvedPath: "src/missing.ts",
    });
    expect(result.data.history).toMatchObject({
      totalCommits: 0,
      loadedCommits: 0,
    });
    expect(result.data.windows).toMatchObject({
      recent: {
        days: 7,
        commits: 0,
      },
      baseline: {
        days: 30,
        commits: 0,
        touchedPaths: 0,
        uniqueAuthors: 0,
        churn: 0,
      },
    });
    expect(result.data.pending).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      totalPaths: 0,
    });
    expect(result.data.evidence.rankedItems).toBe(0);
    expect(result.data.scores).toMatchObject({
      ownershipClarity: { value: 0 },
      recentChangePressure: { value: 0 },
      pendingChangePressure: { value: 0 },
      evidenceCoverage: { value: 0 },
      stability: {
        value: 50,
        interpretation: "mixed recent stability",
      },
    });
    expect(result.data.assessment).toMatchObject({
      label: "watch",
      reasons: ["signals are mixed across recency, ownership, and evidence"],
    });
    expect(result.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "stability-history:src/missing.ts" }),
        expect.objectContaining({ id: "evidence:src/missing.ts" }),
      ]),
    );
  });

  it("counts untracked pending paths in stability reports", async () => {
    const shell = createShellStub([
      ...createRepoResponses("", "src/a.ts\nsrc/other.ts"),
      ...createHistoryResponses("src/a.ts", 2, createFileHistoryLog()),
    ]);

    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell, rootDir: tempRoot }).gw_stability_report;
    if (!toolDef) {
      throw new Error("expected gw_stability_report tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src/a.ts",
        recent_window_days: 7,
        baseline_window_days: 30,
        limit: 5,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.data.pending).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 1,
      totalPaths: 1,
    });
    expect(result.data.scores.pendingChangePressure).toMatchObject({
      value: 100,
      formula: "100 * (pending_paths / max(1, baseline_touched_paths))",
    });
    expect(result.data.scores.pendingChangePressure.factors[0]).toMatchObject({
      key: "pending_path_share",
      signals: [
        expect.objectContaining({ label: "Pending paths", value: 1 }),
        expect.objectContaining({ label: "Baseline touched paths", value: 1 }),
      ],
    });
    expect(result.data.assessment.label).toBe("volatile");
  });

  it("reports unsupported stability modes and logs the mode rejection", async () => {
    const warn = vi.spyOn(logger, "warn");
    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({ shell: createShellStub([]), rootDir: tempRoot })
      .gw_stability_report;
    if (!toolDef) {
      throw new Error("expected gw_stability_report tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src/a.ts",
        mode: "remote",
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "MODE_NOT_SUPPORTED",
      message: "gw_stability_report currently supports only local mode.",
    });
    expect(warn).toHaveBeenCalledWith(
      "gw_stability_report unsupported mode",
      expect.objectContaining({ tool: "gw_stability_report", mode: "remote" }),
    );
  });

  it("returns stability failure envelopes and logs execution failures", async () => {
    const error = vi.spyOn(logger, "error");
    const { createScoreTools } = await import("../provenance/tooling/score/index.ts");
    const toolDef = createScoreTools({
      shell: createShellStub([
        {
          pattern: "git branch --show-current",
          output: "branch lookup failed",
          shouldError: true,
        },
      ]),
      rootDir: tempRoot,
    }).gw_stability_report;
    if (!toolDef) {
      throw new Error("expected gw_stability_report tool");
    }
    const raw = await toolDef.execute(
      {
        path: "src/a.ts",
        recent_window_days: 7,
        baseline_window_days: 30,
      },
      {} as never,
    );
    const result = JSON.parse(raw);

    expect(result.ok).toBe(false);
    expect(result.summary).toBe("Failed to build a stability report for 'src/a.ts'.");
    expect(result.error).toMatchObject({
      code: "STABILITY_REPORT_UNAVAILABLE",
    });
    expect(result.error.message).toContain("branch lookup failed");
    expect(error).toHaveBeenCalledWith(
      "gw_stability_report failed",
      expect.objectContaining({
        tool: "gw_stability_report",
        path: "src/a.ts",
        error: expect.stringContaining("branch lookup failed"),
      }),
    );
  });
});
