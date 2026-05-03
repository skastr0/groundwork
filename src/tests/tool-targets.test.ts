import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFrameworkToolTargets } from "../index.ts";

describe("framework tool target extractor", () => {
  const rootDir = path.join(path.sep, "repo", "workspace");
  const directory = path.join(rootDir, "plugin", "groundwork");

  it("normalizes top-level and nested path-bearing arguments", () => {
    const absolutePath = path.join(
      rootDir,
      "plugin",
      "groundwork",
      "tests",
      "index.test.ts",
    );
    const result = extractFrameworkToolTargets(
      {
        filePath: "./kernel/index.ts",
        nested: {
          path: "tests/index.test.ts",
        },
        edits: [{ filepath: absolutePath }],
      },
      {
        toolName: "edit",
        directory,
        rootDir,
      },
    );

    expect(result).toEqual({
      toolName: "edit",
      targets: [
        {
          path: "./kernel/index.ts",
          normalizedPath: "plugin/groundwork/kernel/index.ts",
          beforePath: "plugin/groundwork/kernel/index.ts",
          afterPath: "plugin/groundwork/kernel/index.ts",
          source: {
            kind: "argument",
            key: "filePath",
            location: "filePath",
          },
        },
        {
          path: "tests/index.test.ts",
          normalizedPath: "plugin/groundwork/tests/index.test.ts",
          beforePath: "plugin/groundwork/tests/index.test.ts",
          afterPath: "plugin/groundwork/tests/index.test.ts",
          source: {
            kind: "argument",
            key: "path",
            location: "nested.path",
          },
        },
        {
          path: absolutePath,
          normalizedPath: "plugin/groundwork/tests/index.test.ts",
          beforePath: "plugin/groundwork/tests/index.test.ts",
          afterPath: "plugin/groundwork/tests/index.test.ts",
          source: {
            kind: "argument",
            key: "filepath",
            location: "edits[0].filepath",
          },
        },
      ],
      ignoredTargets: [],
    });
  });

  it("ignores out-of-root argument paths without throwing", () => {
    const result = extractFrameworkToolTargets(
      {
        path: path.join(rootDir, "..", "escape.ts"),
        nested: {
          filePath: "../../../escape-2.ts",
        },
      },
      {
        toolName: "read",
        directory,
        rootDir,
      },
    );

    expect(result.targets).toEqual([]);
    expect(result.ignoredTargets).toEqual([
      {
        path: path.join(rootDir, "..", "escape.ts"),
        reason: "outside-root",
        source: {
          kind: "argument",
          key: "path",
          location: "path",
        },
        beforePath: undefined,
        afterPath: undefined,
      },
      {
        path: "../../../escape-2.ts",
        reason: "outside-root",
        source: {
          kind: "argument",
          key: "filePath",
          location: "nested.filePath",
        },
        beforePath: undefined,
        afterPath: undefined,
      },
    ]);
  });

  it("parses patch-style payloads into normalized before and after targets", () => {
    const patchText = [
      "*** Begin Patch",
      "*** Update File: kernel/index.ts",
      "@@",
      "-old",
      "+new",
      "*** Update File: kernel/prompt-context.ts",
      "*** Move to: kernel/prompt-context-renamed.ts",
      "@@",
      "-old",
      "+new",
      "*** Add File: tests/tool-targets.generated.ts",
      "+export const generated = true;",
      "*** Delete File: logger/index.ts",
      "*** Add File: ../../../escape.ts",
      "+bad",
      "*** Add File: bad\0path.ts",
      "+bad",
      "*** End Patch",
    ].join("\n");

    const result = extractFrameworkToolTargets(
      { patchText },
      {
        toolName: "apply_patch",
        directory,
        rootDir,
      },
    );

    expect(result.targets).toEqual([
      {
        path: "kernel/index.ts",
        normalizedPath: "plugin/groundwork/kernel/index.ts",
        beforePath: "plugin/groundwork/kernel/index.ts",
        afterPath: "plugin/groundwork/kernel/index.ts",
        source: {
          kind: "patch",
          key: "patchText",
          location: "patchText#0",
          patchAction: "update",
        },
      },
      {
        path: "kernel/prompt-context-renamed.ts",
        normalizedPath: "plugin/groundwork/kernel/prompt-context-renamed.ts",
        beforePath: "plugin/groundwork/kernel/prompt-context.ts",
        afterPath: "plugin/groundwork/kernel/prompt-context-renamed.ts",
        source: {
          kind: "patch",
          key: "patchText",
          location: "patchText#1",
          patchAction: "move",
        },
      },
      {
        path: "tests/tool-targets.generated.ts",
        normalizedPath: "plugin/groundwork/tests/tool-targets.generated.ts",
        beforePath: undefined,
        afterPath: "plugin/groundwork/tests/tool-targets.generated.ts",
        source: {
          kind: "patch",
          key: "patchText",
          location: "patchText#2",
          patchAction: "add",
        },
      },
      {
        path: "logger/index.ts",
        normalizedPath: "plugin/groundwork/logger/index.ts",
        beforePath: "plugin/groundwork/logger/index.ts",
        afterPath: undefined,
        source: {
          kind: "patch",
          key: "patchText",
          location: "patchText#3",
          patchAction: "delete",
        },
      },
    ]);
    expect(result.ignoredTargets).toEqual([
      {
        path: "../../../escape.ts",
        reason: "outside-root",
        source: {
          kind: "patch",
          key: "patchText",
          location: "patchText#4",
          patchAction: "add",
        },
        beforePath: undefined,
        afterPath: "../../../escape.ts",
      },
      {
        path: "bad\0path.ts",
        reason: "unsafe-path",
        source: {
          kind: "patch",
          key: "patchText",
          location: "patchText#5",
          patchAction: "add",
        },
        beforePath: undefined,
        afterPath: "bad\0path.ts",
      },
    ]);
  });
});
