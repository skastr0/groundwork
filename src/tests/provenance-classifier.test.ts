import { describe, expect, it } from "vitest";
import {
  applyFrameworkAmbientBudget,
  classifyFrameworkAmbientTool,
  createSessionKernelState,
  FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS,
  FRAMEWORK_AMBIENT_PROVENANCE_TOOL_VALUES,
  truncateFrameworkTextByBytes,
} from "../index.ts";

describe("framework ambient provenance classifier", () => {
  const inheritedToolNamesForClassification = ["__proto__", "constructor", "toString"];
  const inheritedToolNamesForBudget = ["__proto__", "constructor"];

  it("maps the default tool set into explicit capture and query strategies", () => {
    expect(
      FRAMEWORK_AMBIENT_PROVENANCE_TOOL_VALUES.map((toolName) =>
        classifyFrameworkAmbientTool(toolName),
      ),
    ).toEqual([
      {
        status: "supported",
        toolName: "read",
        capture: {
          strategy: "path-only",
          budget: {
            itemLimit: 1,
            byteLimit: 2048,
          },
        },
        query: {
          strategy: "file-evidence",
          budget: {
            itemLimit: 6,
            byteLimit: 4096,
          },
        },
      },
      {
        status: "supported",
        toolName: "grep",
        capture: {
          strategy: "path-list",
          budget: {
            itemLimit: 12,
            byteLimit: 4096,
          },
        },
        query: {
          strategy: "workspace-evidence",
          budget: {
            itemLimit: 8,
            byteLimit: 6000,
          },
        },
      },
      {
        status: "supported",
        toolName: "glob",
        capture: {
          strategy: "path-list",
          budget: {
            itemLimit: 12,
            byteLimit: 4096,
          },
        },
        query: {
          strategy: "workspace-evidence",
          budget: {
            itemLimit: 8,
            byteLimit: 6000,
          },
        },
      },
      {
        status: "supported",
        toolName: "edit",
        capture: {
          strategy: "file-diff",
          budget: {
            itemLimit: 8,
            byteLimit: 6144,
          },
        },
        query: {
          strategy: "span-history",
          budget: {
            itemLimit: 6,
            byteLimit: 6000,
          },
        },
      },
      {
        status: "supported",
        toolName: "apply_patch",
        capture: {
          strategy: "file-diff",
          budget: {
            itemLimit: 8,
            byteLimit: 6144,
          },
        },
        query: {
          strategy: "span-history",
          budget: {
            itemLimit: 6,
            byteLimit: 6000,
          },
        },
      },
      {
        status: "supported",
        toolName: "task",
        capture: {
          strategy: "session-artifacts",
          budget: {
            itemLimit: 4,
            byteLimit: 4096,
          },
        },
        query: {
          strategy: "session-evidence",
          budget: {
            itemLimit: 6,
            byteLimit: 6000,
          },
        },
      },
      {
        status: "supported",
        toolName: "bash",
        capture: {
          strategy: "command-metadata",
          budget: {
            itemLimit: 2,
            byteLimit: 2048,
          },
        },
        query: {
          strategy: "repo-evidence",
          budget: {
            itemLimit: 5,
            byteLimit: 4096,
          },
        },
      },
    ]);
  });

  it("returns an explicit unsupported status for tools outside the classifier table", () => {
    expect(classifyFrameworkAmbientTool("write")).toEqual({
      status: "unsupported",
      toolName: "write",
      code: "unsupported_tool",
      message: "Ambient provenance has no target classifier entry for 'write'.",
    });
  });

  it.each(inheritedToolNamesForClassification)(
    "treats inherited name %s as unsupported during classification",
    (toolName) => {
      expect(classifyFrameworkAmbientTool(toolName)).toEqual({
        status: "unsupported",
        toolName,
        code: "unsupported_tool",
        message: `Ambient provenance has no target classifier entry for '${toolName}'.`,
      });
    },
  );

  it("applies capture budgets through dedicated ambient provenance ledgers", () => {
    const state = createSessionKernelState("session-ambient-capture", {
      now: "2026-03-18T09:10:00.000Z",
    });

    const result = applyFrameworkAmbientBudget(state, ["alpha", "beta", "gamma"], {
      toolName: "read",
      phase: "capture",
      now: "2026-03-18T09:10:01.000Z",
      getSize: (item) => Buffer.byteLength(item, "utf8"),
      metadata: {
        purpose: "classifier-test",
      },
    });

    expect(result).toEqual({
      status: "supported",
      toolName: "read",
      phase: "capture",
      classification: classifyFrameworkAmbientTool("read"),
      items: ["alpha"],
      bounds: {
        items: {
          returned: 1,
          limit: 1,
          truncated: true,
        },
        bytes: {
          returned: 5,
          limit: 2048,
          truncated: false,
        },
      },
    });
    expect(state.budgets.ledgers[FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.captureItems]).toEqual({
      used: 1,
      limit: 1,
      unit: "count",
      updatedAt: "2026-03-18T09:10:01.000Z",
      metadata: {
        requestedItems: 3,
        returnedItems: 1,
        itemTruncated: true,
        byteTruncated: false,
        context: {
          toolName: "read",
          phase: "capture",
          purpose: "classifier-test",
        },
      },
    });
    expect(state.budgets.ledgers[FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.captureBytes]).toEqual({
      used: 5,
      limit: 2048,
      unit: "bytes",
      updatedAt: "2026-03-18T09:10:01.000Z",
      metadata: {
        requestedItems: 3,
        returnedItems: 1,
        itemTruncated: true,
        byteTruncated: false,
        context: {
          toolName: "read",
          phase: "capture",
          purpose: "classifier-test",
        },
      },
    });
  });

  it("applies query budgets and preserves explicit unsupported results", () => {
    const state = createSessionKernelState("session-ambient-query", {
      now: "2026-03-18T09:11:00.000Z",
    });

    const queryResult = applyFrameworkAmbientBudget(state, ["alpha", "beta gamma", "delta"], {
      toolName: "bash",
      phase: "query",
      now: "2026-03-18T09:11:01.000Z",
      getSize: (item) => Buffer.byteLength(item, "utf8"),
      truncateItem: (item, maxBytes) => truncateFrameworkTextByBytes(item, maxBytes),
    });

    expect(queryResult).toEqual({
      status: "supported",
      toolName: "bash",
      phase: "query",
      classification: classifyFrameworkAmbientTool("bash"),
      items: ["alpha", "beta gamma", "delta"],
      bounds: {
        items: {
          returned: 3,
          limit: 5,
          truncated: false,
        },
        bytes: {
          returned: 20,
          limit: 4096,
          truncated: false,
        },
      },
    });
    expect(state.budgets.ledgers[FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.queryItems]).toEqual({
      used: 3,
      limit: 5,
      unit: "count",
      updatedAt: "2026-03-18T09:11:01.000Z",
      metadata: {
        requestedItems: 3,
        returnedItems: 3,
        itemTruncated: false,
        byteTruncated: false,
        context: {
          toolName: "bash",
          phase: "query",
        },
      },
    });

    const unsupportedResult = applyFrameworkAmbientBudget(state, ["noop"], {
      toolName: "write",
      phase: "capture",
      now: "2026-03-18T09:11:02.000Z",
      getSize: (item) => Buffer.byteLength(item, "utf8"),
    });

    expect(unsupportedResult).toEqual({
      status: "unsupported",
      toolName: "write",
      code: "unsupported_tool",
      message: "Ambient provenance has no target classifier entry for 'write'.",
    });
  });

  it.each(inheritedToolNamesForBudget)(
    "fails soft when applying capture budgets for inherited name %s",
    (toolName) => {
      const state = createSessionKernelState(`session-ambient-${toolName}`, {
        now: "2026-03-18T10:20:00.000Z",
      });

      expect(
        applyFrameworkAmbientBudget(state, ["noop"], {
          toolName,
          phase: "capture",
          now: "2026-03-18T10:20:01.000Z",
          getSize: (item) => Buffer.byteLength(item, "utf8"),
        }),
      ).toEqual({
        status: "unsupported",
        toolName,
        code: "unsupported_tool",
        message: `Ambient provenance has no target classifier entry for '${toolName}'.`,
      });
      expect(state.budgets.ledgers).toEqual({});
    },
  );
});
