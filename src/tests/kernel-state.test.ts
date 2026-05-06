import { describe, expect, it } from "vitest";
import {
  cleanupSessionKernelState,
  cleanupSessionKernelStates,
  createSessionKernelState,
  createSessionKernelStore,
} from "../index.ts";

describe("session kernel state", () => {
  it("captures prompt context, locks, caches, budgets, and pending tool data in a neutral shape", () => {
    const source = {
      promptContext: {
        messageID: "message-1",
        role: "user",
        agent: "builder",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        system: "preserve context",
        variant: "careful",
        tools: {
          read: true,
          edit: true,
        },
      },
      locks: {
        active: {
          mutatingTools: {
            scope: "mutating-tools" as const,
            reason: "Need human override before continuing.",
            source: "groundwork-policy",
            createdAt: "2026-05-30T05:00:01.000Z",
            paths: ["plugin/groundwork/policy/runtime.ts"],
            metadata: {
              ruleId: "policy.override",
            },
          },
          termination: {
            scope: "session" as const,
            reason: "Terminal violation locked the session.",
            source: "groundwork-policy",
            createdAt: "2026-05-30T05:00:02.000Z",
          },
        },
      },
      caches: {
        buckets: {
          promptContext: {
            entries: {
              latest: {
                value: {
                  agent: "builder",
                  model: "openai/gpt-5.4",
                },
                updatedAt: "2026-05-30T05:00:03.000Z",
              },
            },
          },
          contentMatches: {
            entries: {
              "rule-1::plugin/example.ts": {
                value: true,
                updatedAt: "2026-05-30T05:00:04.000Z",
              },
            },
          },
        },
      },
      budgets: {
        ledgers: {
          sessionMessages: {
            used: 10,
            limit: 50,
            unit: "count" as const,
            updatedAt: "2026-05-30T05:00:05.000Z",
          },
          evidenceBytes: {
            used: 8192,
            limit: 1048576,
            unit: "bytes" as const,
            updatedAt: "2026-05-30T05:00:06.000Z",
          },
        },
      },
      pendingTools: {
        calls: {
          "call-1": {
            callID: "call-1",
            toolName: "edit_file",
            phase: "after" as const,
            capturedAt: "2026-05-30T05:00:07.000Z",
            args: {
              filePath: "plugin/example.ts",
            },
            targets: [
              {
                path: "plugin/example.ts",
                normalizedPath: "plugin/example.ts",
                changedLineRanges: [{ startLine: 1, endLine: 3 }],
                source: {
                  kind: "argument" as const,
                  key: "filePath",
                  location: "filePath",
                },
                metadata: {
                  readBeforePath: "plugin/example.ts",
                  readAfterPath: "plugin/example.ts",
                },
              },
            ],
            data: {
              source: "groundwork-provenance",
            },
          },
        },
      },
      metadata: {
        origin: "framework-scaffold",
      },
    };

    const state = createSessionKernelState("session-1", {
      now: "2026-05-30T05:00:00.000Z",
      ...source,
    });

    expect(state).toEqual({
      sessionID: "session-1",
      createdAt: "2026-05-30T05:00:00.000Z",
      updatedAt: "2026-05-30T05:00:00.000Z",
      ...source,
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual({
      sessionID: "session-1",
      createdAt: "2026-05-30T05:00:00.000Z",
      updatedAt: "2026-05-30T05:00:00.000Z",
      ...source,
    });

    source.promptContext.tools.read = false;
    source.locks.active.mutatingTools.paths?.push(
      "plugin/groundwork/provenance/runtime.ts",
    );
    source.pendingTools.calls["call-1"]?.targets[0]?.changedLineRanges?.push({
      startLine: 8,
      endLine: 9,
    });

    expect(state.promptContext?.tools?.read).toBe(true);
    expect(state.locks.active.mutatingTools?.paths).toEqual([
      "plugin/groundwork/policy/runtime.ts",
    ]);
    expect(state.pendingTools.calls["call-1"]?.targets[0]?.changedLineRanges).toEqual([
      { startLine: 1, endLine: 3 },
    ]);
    expect(state.pendingTools.calls["call-1"]?.targets[0]?.source).toEqual({
      kind: "argument",
      key: "filePath",
      location: "filePath",
    });
  });

  it("creates, snapshots, and cleans up per-session stores without coupling to a layer", () => {
    const timestamps = [
      "2026-05-30T06:00:00.000Z",
      "2026-05-30T06:00:01.000Z",
      "2026-05-30T06:00:02.000Z",
      "2026-05-30T06:00:03.000Z",
    ];
    const store = createSessionKernelStore({
      now: () => timestamps.shift() ?? "2026-05-30T06:00:59.000Z",
    });

    const created = store.create("session-1", {
      promptContext: {
        role: "user",
        agent: "builder",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
    });

    expect(created).toEqual({
      sessionID: "session-1",
      createdAt: "2026-05-30T06:00:00.000Z",
      updatedAt: "2026-05-30T06:00:00.000Z",
      promptContext: {
        role: "user",
        agent: "builder",
        model: { providerID: "openai", modelID: "gpt-5.4" },
      },
      locks: { active: {} },
      caches: { buckets: {} },
      budgets: { ledgers: {} },
      pendingTools: { calls: {} },
      metadata: undefined,
    });
    expect(store.size()).toBe(1);

    const mutated = store.get("session-1");
    expect(mutated).not.toBeNull();
    mutated!.locks.active.lockA = {
      scope: "session",
      reason: "local mutation should not escape",
      source: "test",
      createdAt: "2026-05-30T06:00:01.500Z",
    };
    expect(store.get("session-1")?.locks.active).toEqual({});

    const updated = store.set({
      ...created,
      pendingTools: {
        calls: {
          "call-2": {
            callID: "call-2",
            toolName: "apply_patch",
            phase: "before",
            capturedAt: "2026-05-30T06:00:01.250Z",
            targets: [{ path: "plugin/groundwork/index.ts" }],
          },
        },
      },
    });

    expect(updated.createdAt).toBe("2026-05-30T06:00:00.000Z");
    expect(updated.updatedAt).toBe("2026-05-30T06:00:01.000Z");
    expect(store.snapshot()).toEqual([updated]);

    store.create("session-2");
    expect(cleanupSessionKernelState(store, "session-1")).toBe(true);
    expect(store.get("session-1")).toBeNull();
    expect(cleanupSessionKernelStates(store, ["session-2", "missing-session"])).toBe(1);
    expect(store.size()).toBe(0);

    store.create("session-3");
    store.create("session-4");
    expect(cleanupSessionKernelStates(store)).toBe(2);
    expect(store.snapshot()).toEqual([]);
  });
});
