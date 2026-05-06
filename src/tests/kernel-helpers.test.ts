import { describe, expect, it } from "vitest";
import {
  applyFrameworkEvidenceBudget,
  applyFrameworkPromptBudget,
  createFrameworkActionDedupeKey,
  createFrameworkSyntheticInjectionDedupeKey,
  createSessionKernelState,
  FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS,
  FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS,
  getFrameworkCacheEntry,
  rememberFrameworkAction,
  rememberFrameworkSyntheticInjection,
  setFrameworkCacheEntry,
  truncateFrameworkTextByBytes,
} from "../index.ts";

describe("framework kernel helpers", () => {
  it("stores cache entries and suppresses duplicate synthetic injections and framework actions", () => {
    const state = createSessionKernelState("session-1", {
      now: "2026-05-30T07:00:00.000Z",
    });

    const cached = setFrameworkCacheEntry(state, {
      bucket: "prompt-context",
      key: "latest",
      value: {
        agent: "builder",
      },
      now: "2026-05-30T07:00:01.000Z",
    });

    expect(cached).toEqual({
      value: {
        agent: "builder",
      },
      updatedAt: "2026-05-30T07:00:01.000Z",
      expiresAt: undefined,
      metadata: undefined,
    });
    expect(getFrameworkCacheEntry(state, "prompt-context", "latest")).toEqual(cached);

    const firstInjection = rememberFrameworkSyntheticInjection(state, {
      now: "2026-05-30T07:00:02.000Z",
      source: "groundwork-policy",
      text: "Keep synthetic guidance bounded.",
      metadata: {
        channel: "system",
      },
    });
    const secondInjection = rememberFrameworkSyntheticInjection(state, {
      now: "2026-05-30T07:00:03.000Z",
      source: "groundwork-policy",
      text: "  Keep synthetic guidance bounded.  ",
      metadata: {
        channel: "system",
      },
    });

    expect(firstInjection.key).toBe(
      createFrameworkSyntheticInjectionDedupeKey({
        source: "groundwork-policy",
        text: "Keep synthetic guidance bounded.",
      }),
    );
    expect(firstInjection.duplicate).toBe(false);
    expect(secondInjection.duplicate).toBe(true);
    expect(
      getFrameworkCacheEntry(
        state,
        FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS.syntheticInjections,
        firstInjection.key,
      ),
    ).toEqual({
      value: {
        scope: "synthetic-injection",
        key: firstInjection.key,
        hits: 2,
        firstSeenAt: "2026-05-30T07:00:02.000Z",
        lastSeenAt: "2026-05-30T07:00:03.000Z",
      },
      updatedAt: "2026-05-30T07:00:03.000Z",
      expiresAt: undefined,
      metadata: {
        source: "groundwork-policy",
        variant: undefined,
        context: {
          channel: "system",
        },
      },
    });

    const firstAction = rememberFrameworkAction(state, {
      now: "2026-05-30T07:00:04.000Z",
      source: "groundwork-policy",
      action: "ensure-skill-loaded",
      parts: [{ skills: ["ddd", "effect"], mode: "strict" }],
    });
    const secondAction = rememberFrameworkAction(state, {
      now: "2026-05-30T07:00:05.000Z",
      source: "groundwork-policy",
      action: "ensure-skill-loaded",
      parts: [{ mode: "strict", skills: ["ddd", "effect"] }],
    });

    expect(firstAction.key).toBe(
      createFrameworkActionDedupeKey({
        source: "groundwork-policy",
        action: "ensure-skill-loaded",
        parts: [{ mode: "strict", skills: ["ddd", "effect"] }],
      }),
    );
    expect(firstAction.duplicate).toBe(false);
    expect(secondAction.duplicate).toBe(true);
    expect(
      getFrameworkCacheEntry(
        state,
        FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS.frameworkActions,
        firstAction.key,
      ),
    ).toEqual({
      value: {
        scope: "framework-action",
        key: firstAction.key,
        hits: 2,
        firstSeenAt: "2026-05-30T07:00:04.000Z",
        lastSeenAt: "2026-05-30T07:00:05.000Z",
      },
      updatedAt: "2026-05-30T07:00:05.000Z",
      expiresAt: undefined,
      metadata: {
        source: "groundwork-policy",
        action: "ensure-skill-loaded",
      },
    });
  });

  it("applies prompt budgets and truncates oversized text to the byte cap", () => {
    const state = createSessionKernelState("session-2", {
      now: "2026-05-30T08:00:00.000Z",
    });

    const result = applyFrameworkPromptBudget(state, ["alpha", "beta gamma", "delta"], {
      now: "2026-05-30T08:00:01.000Z",
      itemLimit: 3,
      byteLimit: 10,
      getSize: (item) => Buffer.byteLength(item, "utf8"),
      truncateItem: (item, maxBytes) => truncateFrameworkTextByBytes(item, maxBytes),
      metadata: {
        purpose: "context",
      },
    });

    expect(result).toEqual({
      items: ["alpha", "be..."],
      bounds: {
        items: {
          returned: 2,
          limit: 3,
          truncated: true,
        },
        bytes: {
          returned: 10,
          limit: 10,
          truncated: true,
        },
      },
    });
    expect(state.budgets.ledgers[FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.promptItems]).toEqual({
      used: 2,
      limit: 3,
      unit: "count",
      updatedAt: "2026-05-30T08:00:01.000Z",
      metadata: {
        requestedItems: 3,
        returnedItems: 2,
        itemTruncated: true,
        byteTruncated: true,
        context: {
          purpose: "context",
        },
      },
    });
    expect(state.budgets.ledgers[FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.promptBytes]).toEqual({
      used: 10,
      limit: 10,
      unit: "bytes",
      updatedAt: "2026-05-30T08:00:01.000Z",
      metadata: {
        requestedItems: 3,
        returnedItems: 2,
        itemTruncated: true,
        byteTruncated: true,
        context: {
          purpose: "context",
        },
      },
    });
  });

  it("applies evidence budgets with explicit item and byte ledgers", () => {
    const state = createSessionKernelState("session-3", {
      now: "2026-05-30T09:00:00.000Z",
    });
	    const evidence = [
	      { kind: "message", summary: "one" },
	      { kind: "session", summary: "two" },
	      { kind: "work-item", summary: "three" },
	    ] as const;

    const result = applyFrameworkEvidenceBudget(state, evidence, {
      now: "2026-05-30T09:00:01.000Z",
      itemLimit: 2,
      byteLimit: 1024,
      getSize: (item) => Buffer.byteLength(JSON.stringify(item), "utf8"),
      metadata: {
        purpose: "provenance",
      },
    });

    expect(result.items).toEqual(evidence.slice(0, 2));
    expect(result.bounds.items).toEqual({
      returned: 2,
      limit: 2,
      truncated: true,
    });
    expect(result.bounds.bytes).toEqual({
      returned: result.bounds.bytes.returned,
      limit: 1024,
      truncated: false,
    });
    expect(state.budgets.ledgers[FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.evidenceItems]).toEqual({
      used: 2,
      limit: 2,
      unit: "count",
      updatedAt: "2026-05-30T09:00:01.000Z",
      metadata: {
        requestedItems: 3,
        returnedItems: 2,
        itemTruncated: true,
        byteTruncated: false,
        context: {
          purpose: "provenance",
        },
      },
    });
    expect(state.budgets.ledgers[FRAMEWORK_KERNEL_BUDGET_LEDGER_KEYS.evidenceBytes]).toMatchObject({
      used: result.bounds.bytes.returned,
      limit: 1024,
      unit: "bytes",
      updatedAt: "2026-05-30T09:00:01.000Z",
      metadata: {
        requestedItems: 3,
        returnedItems: 2,
        itemTruncated: true,
        byteTruncated: false,
        context: {
          purpose: "provenance",
        },
      },
    });
  });
});
