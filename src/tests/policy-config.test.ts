import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractCandidatePaths,
  extractChangeTargets,
  filterPathsByRuleContent,
  findMatchingRules,
  hasMatchingWorkItem,
  loadMergedPolicyConfig,
  mergePolicyConfigs,
  normalizePathForMatching,
  parsePolicyConfig,
  resolveRuleScope,
  resolveGlobalPolicyConfigPath,
  resolveGlobalPolicyConfigPaths,
  resolveProjectPolicyConfigPath,
  resolveProjectPolicyConfigPaths,
  runContentMatcher,
  ruleMatchesTool,
} from "../policy/config.ts";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (root) => {
      await fs.rm(root, { recursive: true, force: true });
    }),
  );
});

describe("policy config parser", () => {
  it("parses a valid config with ast-grep content matcher", () => {
    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "plugin-guidance",
          match: ["plugin/**"],
          content_mode: "any",
          content: [
            {
              type: "ast_grep",
              language: "ts",
              pattern: 'import $A from "$B"',
              selector: "import_statement",
              strictness: "smart",
            },
          ],
          actions: [
            {
              type: "inject_prompt",
              text: "load plugin-writing skill",
              once_per_session: true,
            },
          ],
        },
      ],
    });

    expect(config.rules).toHaveLength(1);
    expect(config.rules[0]?.id).toBe("plugin-guidance");
    expect(config.rules[0]?.content?.[0]?.type).toBe("ast_grep");
    if (config.rules[0]?.content?.[0]?.type === "ast_grep") {
      expect(config.rules[0].content[0].selector).toBe("import_statement");
    }
  });

  it("rejects empty ast-grep selectors", () => {
    expect(() =>
      parsePolicyConfig({
        version: 1,
        rules: [
          {
            id: "bad-selector",
            match: ["plugin/**"],
            content: [
              {
                type: "ast_grep",
                pattern: 'import $A from "$B"',
                selector: "   ",
              },
            ],
            actions: [{ type: "inject_prompt", text: "x" }],
          },
        ],
      }),
    ).toThrow("invalid selector");
  });

  it("throws for unsupported action type", () => {
    expect(() =>
      parsePolicyConfig({
        version: 1,
        rules: [{ id: "bad", match: ["**/*"], actions: [{ type: "unknown" }] }],
      }),
    ).toThrow("Unsupported action type");
  });

  it("throws for unsupported content matcher type", () => {
    expect(() =>
      parsePolicyConfig({
        version: 1,
        rules: [
          {
            id: "bad-content",
            match: ["plugin/**"],
            content: [{ type: "regex", pattern: "foo" }],
            actions: [{ type: "inject_prompt", text: "x" }],
          },
        ],
      }),
    ).toThrow("Unsupported content matcher type");
  });

  it("parses semgrep content matcher", () => {
    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "semgrep-rule",
          match: ["plugin/**/*.ts"],
          content_mode: "any",
          content: [
            {
              type: "semgrep",
              configs: ["~/.semgrep/custom", "./rules/semgrep"],
              severity: ["ERROR", "warning"],
              timeout_s: 3,
            },
          ],
          actions: [{ type: "inject_prompt", text: "semgrep matched" }],
        },
      ],
    });

    const matcher = config.rules[0]?.content?.[0];
    expect(matcher?.type).toBe("semgrep");
    if (matcher?.type === "semgrep") {
      expect(matcher.configs).toHaveLength(2);
      expect(matcher.severity).toEqual(["ERROR", "WARNING"]);
      expect(matcher.timeout_s).toBe(3);
    }
  });

  it("rejects mixed matcher types in the same rule", () => {
    expect(() =>
      parsePolicyConfig({
        version: 1,
        rules: [
          {
            id: "mixed",
            match: ["plugin/**/*.ts"],
            content: [
              { type: "ast_grep", pattern: "tool({$$$ARGS})" },
              { type: "semgrep", configs: ["./rules"] },
            ],
            actions: [{ type: "inject_prompt", text: "x" }],
          },
        ],
      }),
    ).toThrow("mixes content matcher types");
  });

  it("parses severity, matcher expectations, plugins, includes, tool filters, scope, and ensure_skill_loaded", () => {
    const config = parsePolicyConfig({
      version: 1,
      plugins: ["groundwork-effect"],
      includes: ["./policy.auth.toml", "./policy.queue.toml"],
      rules: [
        {
          id: "auth-rule",
          severity: "terminate",
          match: ["apps/backend/**/*.ts"],
          tools_include: ["edit", "write"],
          tools_exclude: ["read"],
          content_mode: "all",
          scope: "changed_lines",
          content: [
            {
              type: "ast_grep",
              pattern: "middleware.auth($$$ARGS)",
              expect: "absent",
            },
          ],
          actions: [
            {
              type: "ensure_skill_loaded",
              skills: ["auth-hardening", "sdlc"],
              mode: "block",
            },
          ],
        },
      ],
    });

    expect(config.plugins).toEqual(["groundwork-effect"]);
    expect(config.includes).toEqual(["./policy.auth.toml", "./policy.queue.toml"]);
    expect(config.rules[0]?.severity).toBe("terminate");
    expect(config.rules[0]?.tools_include).toEqual(["edit", "write"]);
    expect(config.rules[0]?.tools_exclude).toEqual(["read"]);
    expect(config.rules[0]?.scope).toBe("changed_lines");
    expect(config.rules[0]?.content?.[0]?.expect).toBe("absent");
    expect(config.rules[0]?.actions[0]?.type).toBe("ensure_skill_loaded");
  });

  it("allows composition-only configs with plugins or includes", () => {
    expect(parsePolicyConfig({ version: 1, plugins: ["groundwork-effect"] })).toEqual({
      version: 1,
      plugins: ["groundwork-effect"],
      includes: [],
      rules: [],
    });
    expect(parsePolicyConfig({ version: 1, includes: [".groundwork/policy.*.toml"] })).toEqual({
      version: 1,
      plugins: [],
      includes: [".groundwork/policy.*.toml"],
      rules: [],
    });
  });

  it("rejects duplicate rule ids in the same config", () => {
    expect(() =>
      parsePolicyConfig({
        version: 1,
        rules: [
          {
            id: "duplicate",
            match: ["a/**"],
            actions: [{ type: "inject_prompt", text: "a" }],
          },
          {
            id: "duplicate",
            match: ["b/**"],
            actions: [{ type: "inject_prompt", text: "b" }],
          },
        ],
      }),
    ).toThrow("Duplicate rule id");
  });
});

describe("path matching", () => {
  it("extracts candidate paths from nested args", () => {
    const paths = extractCandidatePaths({
      filePath: "plugin/review/index.ts",
      output_path: ".agents/local-stories/out.artifact",
      nested: {
        items: [{ path: "./plugin/review/local-story.ts" }],
      },
    });

    expect(paths).toContain("plugin/review/index.ts");
    expect(paths).toContain(".agents/local-stories/out.artifact");
    expect(paths).toContain("./plugin/review/local-story.ts");
  });

  it("does not treat generic multiline strings as paths", () => {
    const paths = extractCandidatePaths({
      content: "line one\nline two",
      nested: {
        body: "another\nmultiline\nvalue",
      },
    });

    expect(paths).toEqual([]);
  });

  it("extracts file paths from apply_patch patchText", () => {
    const paths = extractCandidatePaths({
      patchText: `*** Begin Patch
*** Update File: src/main.ts
*** Move to: src/renamed.ts
@@
-old
+new
*** Add File: src/new.ts
+hello
*** Delete File: src/old.ts
*** End Patch`,
    });

    expect(paths).toEqual(["src/main.ts", "src/renamed.ts", "src/new.ts", "src/old.ts"]);
  });

  it("extracts changed line targets from apply_patch hunks", () => {
    const targets = extractChangeTargets("/Users/me/project", {
      patchText: `*** Begin Patch
*** Update File: src/main.ts
*** Move to: src/renamed.ts
@@ -4,3 +10,4 @@
 context
-old
+new
 context-2
+extra
*** Update File: src/second.ts
@@ -1 +1 @@
-before
+after
@@ -8,0 +9,2 @@
+extra
+extra2
*** End Patch`,
    });

    expect(targets).toEqual([
      {
        normalizedPath: "src/renamed.ts",
        changedLineRanges: [
          { startLine: 11, endLine: 11 },
          { startLine: 13, endLine: 13 },
        ],
        deletedLineRanges: [{ startLine: 5, endLine: 5 }],
      },
      {
        normalizedPath: "src/second.ts",
        changedLineRanges: [
          { startLine: 1, endLine: 1 },
          { startLine: 9, endLine: 10 },
        ],
        deletedLineRanges: [{ startLine: 1, endLine: 1 }],
      },
    ]);
  });

  it("ignores malformed patch headers", () => {
    const paths = extractCandidatePaths({
      patchText: `*** Begin Patch
*** Update File src/main.ts
*** Move to src/renamed.ts
*** Add file: src/new.ts
*** Delete File:
*** End Patch`,
    });

    expect(paths).toEqual([]);
  });

  it("matches rules with glob patterns", () => {
    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "plugin-rule",
          match: ["plugin/**"],
          actions: [{ type: "inject_prompt", text: "load plugin-writing skill" }],
        },
      ],
    });

    const normalizedPath = normalizePathForMatching(
      "/Users/me/project",
      "/Users/me/project/plugin/review/index.ts",
    );
    const matches = findMatchingRules(config, [normalizedPath]);

    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("plugin-rule");
  });

  it("matches **/*.ts globs for direct children", () => {
    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "queue-rule",
          match: ["apps/backend/commands/queue/**/*.ts"],
          actions: [{ type: "inject_prompt", text: "queue guidance" }],
        },
      ],
    });

    const directChild = "apps/backend/commands/queue/start_mondrian_bus_queue.ts";
    const nestedChild = "apps/backend/commands/queue/internal/start.ts";

    const directMatches = findMatchingRules(config, [directChild]);
    const nestedMatches = findMatchingRules(config, [nestedChild]);

    expect(directMatches).toHaveLength(1);
    expect(directMatches[0]?.id).toBe("queue-rule");
    expect(nestedMatches).toHaveLength(1);
    expect(nestedMatches[0]?.id).toBe("queue-rule");
  });

  it("defaults tool matching to edit-focused tools and allows overrides", () => {
    const [defaultRule, explicitRule] = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "default-tools",
          match: ["plugin/**"],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
        {
          id: "explicit-tools",
          match: ["plugin/**"],
          tools_include: ["*"],
          tools_exclude: ["read"],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules;

    expect(defaultRule).toBeDefined();
    expect(explicitRule).toBeDefined();
    expect(ruleMatchesTool(defaultRule!, "edit")).toBe(true);
    expect(ruleMatchesTool(defaultRule!, "read")).toBe(false);
    expect(ruleMatchesTool(explicitRule!, "write")).toBe(true);
    expect(ruleMatchesTool(explicitRule!, "read")).toBe(false);
  });
});

describe("content matching", () => {
  it("filters paths using content matcher runner", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    await fs.writeFile(path.join(root, "plugin", "review", "a.ts"), "export const a = 1;");
    await fs.writeFile(path.join(root, "plugin", "review", "b.ts"), "export const b = 2;");

    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "content-rule",
          match: ["plugin/**/*.ts"],
          scope: "full_file",
          content_mode: "any",
          content: [{ type: "ast_grep", pattern: "export const $A = 1" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    });

    const rule = config.rules[0];
    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      normalizedPaths: ["plugin/review/a.ts", "plugin/review/b.ts"],
      rule,
      runner: async ({ filePath }) => filePath.endsWith("a.ts"),
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
  });

  it("supports absence matching with expect = absent", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    await fs.writeFile(path.join(root, "plugin", "review", "a.ts"), "export const a = 1;");
    await fs.writeFile(path.join(root, "plugin", "review", "b.ts"), "export const b = 2;");

    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "absence-rule",
          match: ["plugin/**/*.ts"],
          scope: "full_file",
          content_mode: "all",
          content: [
            {
              type: "ast_grep",
              pattern: "export const $A = 1",
              expect: "absent",
            },
          ],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    });

    const rule = config.rules[0];
    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      normalizedPaths: ["plugin/review/a.ts", "plugin/review/b.ts"],
      rule,
      runner: async ({ filePath }) => filePath.endsWith("a.ts"),
    });

    expect(result).toEqual(["plugin/review/b.ts"]);
  });

  it("supports changed_lines scope for content checks", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    await fs.writeFile(
      path.join(root, "plugin", "review", "a.ts"),
      ["const keep = 1;", "const next = 2;"].join("\n"),
    );

    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "changed-lines-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [{ type: "ast_grep", pattern: "const $A = $B" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    });

    const rule = config.rules[0];
    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      normalizedPaths: ["plugin/review/a.ts"],
      rule,
      beforeContents: new Map([["plugin/review/a.ts", null]]),
      regionRunner: async () => [{ startLine: 2, endLine: 2 }],
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
  });

  it("prefers target changed ranges over diff fallback when provided", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    await fs.writeFile(
      path.join(root, "plugin", "review", "a.ts"),
      ["const keep = 1;", "const next = 2;"].join("\n"),
    );

    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "changed-lines-target-range-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [{ type: "ast_grep", pattern: "const $A = $B" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    });

    const rule = config.rules[0];
    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      targets: [
        {
          normalizedPath: "plugin/review/a.ts",
          beforeContent: null,
          changedLineRanges: [{ startLine: 2, endLine: 2 }],
        },
      ],
      rule,
      regionRunner: async () => [{ startLine: 1, endLine: 1 }],
    });

    expect(result).toEqual([]);
  });

  it("flags deleted code using before-content snippet windows", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    await fs.writeFile(
      path.join(root, "plugin", "review", "a.ts"),
      ["const keep = 1;", "const keep2 = 2;"].join("\n"),
    );

    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "deleted-critical-code-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [{ type: "ast_grep", pattern: "criticalCall($ARG)" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      targets: [
        {
          normalizedPath: "plugin/review/a.ts",
          changedLineRanges: [],
          deletedLineRanges: [{ startLine: 2, endLine: 2 }],
          beforeContent: ["const keep = 1;", "criticalCall(secret);", "const keep2 = 2;"].join(
            "\n",
          ),
        },
      ],
      rule,
      regionRunner: async ({ snippet }) => {
        if (!snippet || snippet.source !== "before") {
          return [];
        }

        return [{ startLine: 2 - snippet.baseLine + 1, endLine: 2 - snippet.baseLine + 1 }];
      },
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
  });

  it("runs ast-grep snippet scans against in-memory changed windows", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    const filePath = path.join(root, "plugin", "review", "a.ts");
    const fileLines = Array.from(
      { length: 80 },
      (_, index) => `const value${index + 1} = ${index + 1};`,
    );
    fileLines[49] = "console.log(target);";
    await fs.writeFile(filePath, fileLines.join("\n"));

    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "ast-grep-snippet-runtime-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [{ type: "ast_grep", language: "ts", pattern: "console.log($ARG)" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      targets: [
        {
          normalizedPath: "plugin/review/a.ts",
          changedLineRanges: [{ startLine: 50, endLine: 50 }],
          beforeContent: fileLines.join("\n"),
        },
      ],
      rule,
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
  });

  it("uses snippet windows and maps snippet-relative regions back to file lines", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    const filePath = path.join(root, "plugin", "review", "a.ts");
    const fileLines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
    await fs.writeFile(filePath, fileLines.join("\n"));

    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "snippet-window-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [{ type: "ast_grep", pattern: "line $VALUE" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    if (!rule) throw new Error("missing rule");

    let seenSnippet:
      | {
          baseLine: number;
          content: string;
        }
      | undefined;

    const result = await filterPathsByRuleContent({
      rootDir: root,
      targets: [
        {
          normalizedPath: "plugin/review/a.ts",
          changedLineRanges: [{ startLine: 50, endLine: 50 }],
          beforeContent: fileLines.join("\n"),
        },
      ],
      rule,
      regionRunner: async ({ snippet }) => {
        seenSnippet = snippet;
        if (!snippet) {
          return [];
        }

        return [
          {
            startLine: 50 - snippet.baseLine + 1,
            endLine: 50 - snippet.baseLine + 1,
          },
        ];
      },
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
    expect(seenSnippet?.baseLine).toBe(38);
    expect(seenSnippet?.content).toContain("line 38");
    expect(seenSnippet?.content).toContain("line 62");
  });

  it("supports absence checks inside snippet windows", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    const filePath = path.join(root, "plugin", "review", "a.ts");
    const fileLines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
    await fs.writeFile(filePath, fileLines.join("\n"));

    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "snippet-window-absence-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [
            {
              type: "ast_grep",
              pattern: "line $VALUE",
              expect: "absent",
            },
          ],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      targets: [
        {
          normalizedPath: "plugin/review/a.ts",
          changedLineRanges: [{ startLine: 50, endLine: 50 }],
          beforeContent: fileLines.join("\n"),
        },
      ],
      rule,
      regionRunner: async ({ snippet }) => {
        expect(snippet).toBeDefined();
        return [];
      },
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
  });

  it("keeps surrounding context for cross-boundary snippet checks", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    const filePath = path.join(root, "plugin", "review", "a.ts");
    const fileLines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
    fileLines[48] = "const before = 1;";
    fileLines[49] = "const target =";
    fileLines[50] = "  updatedValue;";
    fileLines[51] = "const after = 2;";
    await fs.writeFile(filePath, fileLines.join("\n"));

    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "snippet-window-cross-boundary-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [{ type: "ast_grep", pattern: "const $A = $B" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      targets: [
        {
          normalizedPath: "plugin/review/a.ts",
          changedLineRanges: [{ startLine: 51, endLine: 51 }],
          beforeContent: fileLines.join("\n"),
        },
      ],
      rule,
      regionRunner: async ({ snippet }) => {
        expect(snippet?.content).toContain("const before = 1;");
        expect(snippet?.content).toContain("const after = 2;");
        if (!snippet) {
          return [];
        }

        return [
          {
            startLine: 50 - snippet.baseLine + 1,
            endLine: 52 - snippet.baseLine + 1,
          },
        ];
      },
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
  });

  it("falls back to whole-file matching when snippet windows are too fragmented", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    const filePath = path.join(root, "plugin", "review", "a.ts");
    const fileLines = Array.from({ length: 260 }, (_, index) => `line ${index + 1}`);
    await fs.writeFile(filePath, fileLines.join("\n"));

    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "snippet-window-fallback-rule",
          match: ["plugin/**/*.ts"],
          scope: "changed_lines",
          content: [{ type: "ast_grep", pattern: "line $VALUE" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    if (!rule) throw new Error("missing rule");

    let sawSnippet = false;
    const result = await filterPathsByRuleContent({
      rootDir: root,
      targets: [
        {
          normalizedPath: "plugin/review/a.ts",
          changedLineRanges: [
            { startLine: 1, endLine: 1 },
            { startLine: 30, endLine: 30 },
            { startLine: 60, endLine: 60 },
            { startLine: 90, endLine: 90 },
            { startLine: 120, endLine: 120 },
            { startLine: 150, endLine: 150 },
            { startLine: 180, endLine: 180 },
            { startLine: 210, endLine: 210 },
            { startLine: 240, endLine: 240 },
          ],
          beforeContent: fileLines.join("\n"),
        },
      ],
      rule,
      regionRunner: async ({ snippet }) => {
        sawSnippet = Boolean(snippet);
        return [{ startLine: 240, endLine: 240 }];
      },
    });

    expect(result).toEqual(["plugin/review/a.ts"]);
    expect(sawSnippet).toBe(false);
  });

  it("filters semgrep results by include_rule_ids without CLI rule flags", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    await fs.writeFile(path.join(root, "plugin", "review", "a.ts"), "console.log('x');\n");

    const semgrepConfigPath = path.join(root, "semgrep-rules.yml");
    await fs.writeFile(
      semgrepConfigPath,
      `rules:\n  - id: chosen-rule\n    languages: [generic]\n    severity: ERROR\n    message: chosen\n    pattern-regex: 'debugger'\n\n  - id: other-rule\n    languages: [generic]\n    severity: ERROR\n    message: other\n    pattern-regex: 'console\\.log'\n`,
      "utf8",
    );

    const config = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "semgrep-include-filter",
          match: ["plugin/**/*.ts"],
          scope: "full_file",
          content: [
            {
              type: "semgrep",
              configs: [semgrepConfigPath],
              include_rule_ids: ["chosen-rule"],
            },
          ],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    });

    const rule = config.rules[0];
    if (!rule) throw new Error("missing rule");

    const result = await filterPathsByRuleContent({
      rootDir: root,
      normalizedPaths: ["plugin/review/a.ts"],
      rule,
    });

    expect(result).toEqual([]);
  }, 15_000);

  it("matches ast-grep selectors for object pair rules", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, "plugin", "review"), { recursive: true });
    const filePath = path.join(root, "plugin", "review", "a.ts");
    await fs.writeFile(
      filePath,
      "const payload = { before: 1, 'error.message': message, after: 2 };\n",
    );

    const matcher = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "pair-selector",
          match: ["plugin/**/*.ts"],
          content: [
            {
              type: "ast_grep",
              language: "ts",
              pattern: "const __policy_guardrail = { 'error.message': $VALUE }",
              selector: "pair",
            },
          ],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0]?.content?.[0];

    if (!matcher) throw new Error("missing matcher");

    await expect(
      runContentMatcher({
        rootDir: root,
        filePath,
        matcher,
      }),
    ).resolves.toBe(true);
  });

  it("defaults content rules to changed_lines scope", () => {
    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "default-changed-lines",
          match: ["plugin/**/*.ts"],
          content: [{ type: "ast_grep", pattern: "const $A = $B" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    expect(rule).toBeDefined();
    expect(resolveRuleScope(rule!)).toBe("changed_lines");
  });

  it("keeps full_file whole-file matching explicit", () => {
    const rule = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "explicit-full-file",
          match: ["plugin/**/*.ts"],
          scope: "full_file",
          content: [{ type: "ast_grep", pattern: "const $A = $B" }],
          actions: [{ type: "inject_prompt", text: "x" }],
        },
      ],
    }).rules[0];

    expect(rule).toBeDefined();
    expect(resolveRuleScope(rule!)).toBe("full_file");
  });
});

describe("config merging", () => {
  it("merges global and project rules with project override by id", () => {
    const global = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "shared-rule",
          match: ["plugin/**"],
          actions: [{ type: "inject_prompt", text: "global" }],
        },
        {
          id: "global-only",
          match: ["infra/**"],
          actions: [{ type: "inject_prompt", text: "global infra" }],
        },
      ],
    });

    const project = parsePolicyConfig({
      version: 1,
      rules: [
        {
          id: "shared-rule",
          match: ["plugin/**"],
          actions: [{ type: "inject_prompt", text: "project" }],
        },
      ],
    });

    const merged = mergePolicyConfigs(global, project);
    expect(merged?.rules).toHaveLength(2);
    expect(merged?.rules[0]?.id).toBe("shared-rule");
    expect(merged?.rules[0]?.actions[0]?.type).toBe("inject_prompt");
    if (merged?.rules[0]?.actions[0]?.type === "inject_prompt") {
      expect(merged.rules[0].actions[0].text).toBe("project");
    }
    expect(merged?.rules[1]?.id).toBe("global-only");
  });

  it("loads merged config from Groundwork global and project files", async () => {
    const home = await createTempRoot();
    const root = await createTempRoot();

    const globalPath = path.join(home, ".groundwork", "groundwork.toml");
    const projectPath = path.join(root, "groundwork.toml");

    await fs.mkdir(path.dirname(globalPath), { recursive: true });
    await fs.mkdir(path.dirname(projectPath), { recursive: true });

    await fs.writeFile(
      globalPath,
      toTomlPolicy({ id: "global", match: "plugin/**", text: "global" }),
    );

    await fs.writeFile(
      projectPath,
      toTomlPolicy({ id: "project", match: "src/**", text: "project" }),
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: home });
    expect(merged.sourceCount).toBe(2);
    expect(merged.globalPaths).toEqual([globalPath]);
    expect(merged.projectPaths).toEqual([projectPath]);
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["global", "project"]);
  });

  it("loads project includes using glob patterns", async () => {
    const root = await createTempRoot();
    const projectDir = path.join(root, ".groundwork");
    const projectPath = path.join(projectDir, "policy.toml");
    const includeAPath = path.join(projectDir, "policy.auth.toml");
    const includeBPath = path.join(projectDir, "policy.queue.toml");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      includeAPath,
      toTomlPolicy({
        id: "auth",
        match: "apps/backend/auth/**",
        text: "auth rule",
      }),
    );
    await fs.writeFile(
      includeBPath,
      toTomlPolicy({
        id: "queue",
        match: "apps/backend/queue/**",
        text: "queue rule",
      }),
    );

    await fs.writeFile(
      projectPath,
      `version = 1
includes = ["policy.*.toml"]

[[rules]]
id = "base"
match = ["apps/backend/**"]

[[rules.actions]]
type = "inject_prompt"
text = "base rule"
`,
    );

    const merged = await loadMergedPolicyConfig(root, {
      HOME: path.join(root, "home"),
    });
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["auth", "queue", "base"]);
  });

  it("loads named policy plugins from user Groundwork config", async () => {
    const home = await createTempRoot();
    const root = await createTempRoot();
    const pluginPath = path.join(home, ".groundwork", "groundwork-effect.toml");
    const projectPath = path.join(root, "groundwork.toml");
    await fs.mkdir(path.dirname(pluginPath), { recursive: true });
    await fs.writeFile(
      pluginPath,
      toTomlPolicy({ id: "effect-plugin", match: "src/**", text: "effect plugin" }),
    );
    await fs.writeFile(
      projectPath,
      `version = 1
plugins = ["groundwork-effect"]

[[rules]]
id = "project"
match = ["src/**"]

[[rules.actions]]
type = "inject_prompt"
text = "project"
`,
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: home });
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["effect-plugin", "project"]);
  });

  it("loads tilde policy plugin paths using the configured HOME", async () => {
    const originalHome = process.env.HOME;
    const processHome = await createTempRoot();
    const configuredHome = await createTempRoot();
    const root = await createTempRoot();
    const configuredPluginPath = path.join(configuredHome, ".groundwork", "custom-effect.toml");
    const processPluginPath = path.join(processHome, ".groundwork", "custom-effect.toml");
    await fs.mkdir(path.dirname(configuredPluginPath), { recursive: true });
    await fs.mkdir(path.dirname(processPluginPath), { recursive: true });
    await fs.writeFile(
      configuredPluginPath,
      toTomlPolicy({ id: "configured-home", match: "src/**", text: "configured home" }),
    );
    await fs.writeFile(
      processPluginPath,
      toTomlPolicy({ id: "process-home", match: "src/**", text: "process home" }),
    );
    await fs.writeFile(
      path.join(root, "groundwork.toml"),
      `version = 1
plugins = ["~/.groundwork/custom-effect.toml"]
`,
    );

    try {
      process.env.HOME = processHome;
      const merged = await loadMergedPolicyConfig(root, { HOME: configuredHome });
      expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["configured-home"]);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
    }
  });

  it("loads named policy plugins from project Groundwork config before user plugins", async () => {
    const home = await createTempRoot();
    const root = await createTempRoot();
    const userPluginPath = path.join(home, ".groundwork", "groundwork-effect.toml");
    const projectPluginPath = path.join(root, ".groundwork", ".groundwork-effect.toml");
    await fs.mkdir(path.dirname(userPluginPath), { recursive: true });
    await fs.mkdir(path.dirname(projectPluginPath), { recursive: true });
    await fs.writeFile(
      userPluginPath,
      toTomlPolicy({ id: "user-effect", match: "src/**", text: "user effect" }),
    );
    await fs.writeFile(
      projectPluginPath,
      toTomlPolicy({ id: "project-effect", match: "src/**", text: "project effect" }),
    );
    await fs.writeFile(
      path.join(root, "groundwork.toml"),
      `version = 1
plugins = ["groundwork-effect"]

[[rules]]
id = "project"
match = ["src/**"]

[[rules.actions]]
type = "inject_prompt"
text = "project"
`,
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: home });
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["project-effect", "project"]);
  });

  it("does not let root-level bare plugin files shadow project Groundwork plugins", async () => {
    const home = await createTempRoot();
    const root = await createTempRoot();
    const rootSiblingPath = path.join(root, "groundwork-effect.toml");
    const projectPluginPath = path.join(root, ".groundwork", "groundwork-effect.toml");
    await fs.mkdir(path.dirname(projectPluginPath), { recursive: true });
    await fs.writeFile(
      rootSiblingPath,
      toTomlPolicy({ id: "root-sibling", match: "src/**", text: "root sibling" }),
    );
    await fs.writeFile(
      projectPluginPath,
      toTomlPolicy({ id: "project-plugin", match: "src/**", text: "project plugin" }),
    );
    await fs.writeFile(
      path.join(root, "groundwork.toml"),
      `version = 1
plugins = ["groundwork-effect"]
`,
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: home });
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["project-plugin"]);
  });

  it("loads policy plugins from relative and absolute paths", async () => {
    const root = await createTempRoot();
    const relativePluginPath = path.join(root, ".groundwork", "relative.toml");
    const absolutePluginPath = path.join(root, ".groundwork", "absolute.toml");
    await fs.mkdir(path.dirname(relativePluginPath), { recursive: true });
    await fs.writeFile(
      relativePluginPath,
      toTomlPolicy({ id: "relative-plugin", match: "src/**", text: "relative plugin" }),
    );
    await fs.writeFile(
      absolutePluginPath,
      toTomlPolicy({ id: "absolute-plugin", match: "src/**", text: "absolute plugin" }),
    );
    await fs.writeFile(
      path.join(root, "groundwork.toml"),
      `version = 1
plugins = [".groundwork/relative.toml", "${absolutePluginPath}"]

[[rules]]
id = "project"
match = ["src/**"]

[[rules.actions]]
type = "inject_prompt"
text = "project"
`,
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: path.join(root, "home") });
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual([
      "relative-plugin",
      "absolute-plugin",
      "project",
    ]);
  });

  it("throws when include graph has duplicate rule ids", async () => {
    const root = await createTempRoot();
    const projectDir = path.join(root, ".groundwork");
    const projectPath = path.join(projectDir, "policy.toml");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "policy.shared.toml"),
      toTomlPolicy({
        id: "duplicate-id",
        match: "apps/backend/**",
        text: "include rule",
      }),
    );
    await fs.writeFile(
      projectPath,
      `version = 1
includes = ["policy.shared.toml"]

[[rules]]
id = "duplicate-id"
match = ["apps/frontend/**"]

[[rules.actions]]
type = "inject_prompt"
text = "base rule"
`,
    );

    await expect(loadMergedPolicyConfig(root, { HOME: path.join(root, "home") })).rejects.toThrow(
      "Duplicate rule id",
    );
  });

  it("throws when include graph has a cycle", async () => {
    const root = await createTempRoot();
    const projectDir = path.join(root, ".groundwork");

    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "policy.toml"),
      `version = 1
includes = ["policy.a.toml"]

[[rules]]
id = "root"
match = ["**/*"]

[[rules.actions]]
type = "inject_prompt"
text = "root"
`,
    );

    await fs.writeFile(
      path.join(projectDir, "policy.a.toml"),
      `version = 1
includes = ["policy.b.toml"]

[[rules]]
id = "a"
match = ["**/*"]

[[rules.actions]]
type = "inject_prompt"
text = "a"
`,
    );

    await fs.writeFile(
      path.join(projectDir, "policy.b.toml"),
      `version = 1
includes = ["policy.a.toml"]

[[rules]]
id = "b"
match = ["**/*"]

[[rules.actions]]
type = "inject_prompt"
text = "b"
`,
    );

    await expect(loadMergedPolicyConfig(root, { HOME: path.join(root, "home") })).rejects.toThrow(
      "Policy include cycle detected",
    );
  });

  it("loads multiple Groundwork directory TOML files deterministically", async () => {
    const root = await createTempRoot();
    const projectDir = path.join(root, ".groundwork");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "policy.auth.toml"),
      toTomlPolicy({ id: "auth", match: "apps/auth/**", text: "auth" }),
    );
    await fs.writeFile(
      path.join(projectDir, "policy.queue.toml"),
      toTomlPolicy({ id: "queue", match: "apps/queue/**", text: "queue" }),
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: path.join(root, "home") });
    expect(merged.projectPaths.map((configPath) => path.basename(configPath))).toEqual([
      "policy.auth.toml",
      "policy.queue.toml",
    ]);
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["auth", "queue"]);
  });

  it("does not auto-load policy plugin pack files from Groundwork directories", async () => {
    const root = await createTempRoot();
    const projectDir = path.join(root, ".groundwork");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      path.join(projectDir, "groundwork-effect.toml"),
      toTomlPolicy({ id: "effect", match: "src/**", text: "effect" }),
    );
    await fs.writeFile(
      path.join(projectDir, ".groundwork-security.toml"),
      toTomlPolicy({ id: "security", match: "src/**", text: "security" }),
    );
    await fs.writeFile(
      path.join(projectDir, "policy.auth.toml"),
      toTomlPolicy({ id: "auth", match: "apps/auth/**", text: "auth" }),
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: path.join(root, "home") });
    expect(merged.projectPaths.map((configPath) => path.basename(configPath))).toEqual([
      "policy.auth.toml",
    ]);
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["auth"]);
  });

  it("merges project groundwork.toml with project .groundwork TOML files", async () => {
    const root = await createTempRoot();
    const projectDir = path.join(root, ".groundwork");
    const rootConfig = path.join(root, "groundwork.toml");
    const directoryConfig = path.join(projectDir, "policy.auth.toml");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      rootConfig,
      toTomlPolicy({ id: "root-config", match: "src/**", text: "root config" }),
    );
    await fs.writeFile(
      directoryConfig,
      toTomlPolicy({ id: "directory-config", match: "apps/auth/**", text: "directory config" }),
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: path.join(root, "home") });
    expect(merged.projectPaths).toEqual([rootConfig, directoryConfig]);
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual([
      "root-config",
      "directory-config",
    ]);
  });

  it("lets .groundwork TOML files override root groundwork.toml rules by id", async () => {
    const root = await createTempRoot();
    const projectDir = path.join(root, ".groundwork");
    const rootConfig = path.join(root, "groundwork.toml");
    const directoryConfig = path.join(projectDir, "policy.toml");
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(
      rootConfig,
      toTomlPolicy({ id: "shared", match: "src/**", text: "root shared" }),
    );
    await fs.writeFile(
      directoryConfig,
      toTomlPolicy({ id: "shared", match: "src/**", text: "directory shared" }),
    );

    const merged = await loadMergedPolicyConfig(root, { HOME: path.join(root, "home") });
    expect(merged.config?.rules).toHaveLength(1);
    const action = merged.config?.rules[0]?.actions[0];
    expect(action?.type).toBe("inject_prompt");
    if (action?.type === "inject_prompt") {
      expect(action.text).toBe("directory shared");
    }
  });

  it("uses Groundwork project env overrides", async () => {
    const root = await createTempRoot();
    const groundworkPath = path.join(root, "groundwork.env.toml");
    await fs.writeFile(
      groundworkPath,
      toTomlPolicy({ id: "groundwork-env", match: "src/**", text: "groundwork env" }),
    );

    const merged = await loadMergedPolicyConfig(root, {
      HOME: path.join(root, "home"),
      GROUNDWORK_POLICY_CONFIG: groundworkPath,
    });
    expect(merged.projectPaths).toEqual([groundworkPath]);
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["groundwork-env"]);
  });

  it("uses Groundwork global env overrides", async () => {
    const root = await createTempRoot();
    const home = await createTempRoot();
    const groundworkPath = path.join(home, "groundwork.global.env.toml");
    await fs.writeFile(
      groundworkPath,
      toTomlPolicy({ id: "groundwork-global-env", match: "src/**", text: "groundwork global" }),
    );

    const merged = await loadMergedPolicyConfig(root, {
      HOME: home,
      GROUNDWORK_POLICY_GLOBAL_CONFIG: groundworkPath,
    });
    expect(merged.globalPaths).toEqual([groundworkPath]);
    expect(merged.config?.rules.map((rule) => rule.id)).toEqual(["groundwork-global-env"]);
  });

  it("resolves default config paths", () => {
    const projectPath = resolveProjectPolicyConfigPath("/repo");
    expect(projectPath).toBe("/repo/groundwork.toml");
    expect(resolveProjectPolicyConfigPaths("/repo")).toEqual(["/repo/groundwork.toml"]);

    const globalPath = resolveGlobalPolicyConfigPath({ HOME: "/home/tester" });
    expect(globalPath).toBe("/home/tester/.groundwork/groundwork.toml");
    expect(resolveGlobalPolicyConfigPaths({ HOME: "/home/tester" })).toEqual([
      "/home/tester/.groundwork/groundwork.toml",
    ]);
  });
});

describe("work item requirement", () => {
  it("returns false without active matching work item", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, ".agents", "sdlc", "committed"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, ".agents", "sdlc", "committed", "unrelated.md"),
      "# Unrelated\n\nNo matching paths here.",
    );

    const covered = await hasMatchingWorkItem(root, "infra/prod/main.tf");
    expect(covered).toBe(false);
  });

  it("returns true when active work item references target path", async () => {
    const root = await createTempRoot();
    await fs.mkdir(path.join(root, ".agents", "sdlc", "building"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, ".agents", "sdlc", "building", "policy.md"),
      "# Policy guardrail\n\nTouches plugin/review/index.ts and plugin/review/local-story.ts",
    );

    const covered = await hasMatchingWorkItem(root, "plugin/review/index.ts");
    expect(covered).toBe(true);
  });
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-policy-test-"));
  tempRoots.push(root);
  return root;
}

function toTomlPolicy(input: { id: string; match: string; text: string }): string {
  return `version = 1

[[rules]]
id = "${input.id}"
match = ["${input.match}"]

[[rules.actions]]
type = "inject_prompt"
text = "${input.text}"
`;
}
