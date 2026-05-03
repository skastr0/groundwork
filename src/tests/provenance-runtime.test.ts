import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  classifyFrameworkAmbientTool,
  createFrameworkCompactionContextHook,
  createFrameworkProvenanceLayer,
  createSessionKernelState,
  createSessionKernelStore,
  rememberFrameworkAction,
  renderFrameworkCompactionContext,
  GroundworkPlugin,
  FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS,
  FRAMEWORK_COMPACTION_CONTEXT_MAX_BYTES,
  FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE,
  FRAMEWORK_SYSTEM_TRANSFORM_MAX_BYTES,
  renderFrameworkSystemTransformGuidance,
} from "../index.ts";
import { loadLocalPathEvidence } from "../provenance/index.ts";
import { createFrameworkHookHarness } from "./framework-test-harness.ts";

vi.mock("@opencode-ai/plugin", async () => {
  const { z } = await import("zod");

  const mockTool = ((input: unknown) => input) as {
    (input: unknown): unknown;
    schema: typeof z;
  };
  mockTool.schema = z;

  return {
    tool: mockTool,
  };
});

describe("framework provenance runtime", () => {
  it("keeps the system transform guidance stable and within budget", () => {
    expect(renderFrameworkSystemTransformGuidance()).toMatchInlineSnapshot(`
      "Groundwork reminders:
      - context: honor inherited \`AGENTS.md\`/\`CLAUDE.md\` reminders; deeper files override parents.
      - policy: treat guardrails and tool blocks as binding, not puzzles to route around.
      - provenance: use \`gw_*\` tools when history or trust matters, and separate observed evidence from inference."
    `);
    expect(FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE).toBe(renderFrameworkSystemTransformGuidance());
    expect(Buffer.byteLength(FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE, "utf8")).toBeLessThanOrEqual(
      FRAMEWORK_SYSTEM_TRANSFORM_MAX_BYTES,
    );
  });

  it("injects the guidance once per system-transform output", async () => {
    const layer = await createFrameworkProvenanceLayer();
    const harness = await createFrameworkHookHarness({
      hooks: layer.hooks ?? {},
    });

    try {
      const systemOutput = { system: [] as string[] };

      await harness.invokeHook(
        "experimental.chat.system.transform",
        {
          sessionID: "session-provenance-1",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        },
        systemOutput,
      );
      await harness.invokeHook(
        "experimental.chat.system.transform",
        {
          sessionID: "session-provenance-1",
          model: { providerID: "openai", modelID: "gpt-5.4" },
        },
        systemOutput,
      );

      expect(systemOutput.system).toEqual([FRAMEWORK_SYSTEM_TRANSFORM_GUIDANCE]);
    } finally {
      await harness.cleanup();
    }
  });

  it("exports the gw_* surface from one framework registry path", async () => {
    const { createFrameworkProvenanceTools, FRAMEWORK_PROVENANCE_TOOL_IDS } =
      await import("../provenance/registry.ts");
    const tools = createFrameworkProvenanceTools({
      shell: {} as never,
      rootDir: "/tmp",
    });
    const layer = await createFrameworkProvenanceLayer({
      shell: (() => {
        throw new Error("framework provenance shell stub should not execute in tests");
      }) as never,
      rootDir: "/tmp",
    });

    expect(Object.keys(tools)).toEqual(FRAMEWORK_PROVENANCE_TOOL_IDS);
    expect(Object.keys(layer.toolDefinitions ?? {})).toEqual(FRAMEWORK_PROVENANCE_TOOL_IDS);
  });

  it("augments targeted tool descriptions with concise provenance guidance without changing schemas", async () => {
    const layer = await createFrameworkProvenanceLayer();
    const hook = layer.hooks?.["tool.definition"];

    expect(typeof hook).toBe("function");

    const results = [] as Array<{
      toolID: string;
      description: string;
      schemaStable: boolean;
    }>;

    for (const toolID of ["read", "grep", "edit", "task", "bash", "glob", "write"]) {
      const parameters = { marker: toolID };
      const output = {
        description: `${toolID} description.`,
        parameters,
      };

      await hook?.({ toolID }, output);
      results.push({
        toolID,
        description: output.description,
        schemaStable: output.parameters === parameters,
      });
    }

    expect(results).toEqual([
      {
        toolID: "read",
        description:
          "read description. Provenance: if lineage matters, prefer `gw_read`, `gw_file_state`, or `gw_span_history`.",
        schemaStable: true,
      },
      {
        toolID: "grep",
        description:
          "grep description. Provenance: if match clusters matter, prefer `gw_tree_expand` or `gw_worktree_overview`.",
        schemaStable: true,
      },
      {
        toolID: "edit",
        description:
          "edit description. Provenance: if recent edits are unclear, inspect `gw_span_history` or `gw_file_state` first.",
        schemaStable: true,
      },
      {
        toolID: "task",
        description:
          "task description. Provenance: if delegated work needs verification, ask for cited files or commits and confirm with `gw_pr_expand` or `gw_worktree_overview`.",
        schemaStable: true,
      },
      {
        toolID: "bash",
        description:
          "bash description. Provenance: for repo state or recent history, prefer `gw_repo_state`, `gw_worktree_overview`, or `gw_commit_expand`.",
        schemaStable: true,
      },
      {
        toolID: "glob",
        description: "glob description.",
        schemaStable: true,
      },
      {
        toolID: "write",
        description: "write description.",
        schemaStable: true,
      },
    ]);
  });

  it("captures bounded read evidence consumable by the shared provenance service", async () => {
    const sessionID = "session-provenance-read";
    const now = () => "2026-03-18T11:15:00.000Z";
    const sessionStore = createSessionKernelStore({ now });
    const harness = await createFrameworkHookHarness({
      createHooks: async (context) =>
        (
          await createFrameworkProvenanceLayer({
            directory: context.directory,
            rootDir: context.worktree,
            now,
            sessionStore,
          })
        ).hooks ?? {},
    });
    const readClassification = classifyFrameworkAmbientTool("read");

    if (readClassification.status !== "supported") {
      throw new Error("expected read ambient provenance support");
    }

    try {
      await writeText(
        path.join(harness.rootDir, "src", "example.ts"),
        "export const example = 1;\n",
      );

      await harness.invokeToolBefore(
        { tool: "read", callID: "call-read-1", sessionID },
        { filePath: "src/example.ts", offset: 1, limit: 20 },
      );
      await harness.invokeToolAfter(
        { tool: "read", callID: "call-read-1", sessionID },
        { title: "read", output: "1: export const example = 1;\n", metadata: {} },
      );

      const tracePath = path.join(
        harness.rootDir,
        ".agents",
        "traces",
        `session-${sessionID}.jsonl`,
      );
      const traceLines = (await fs.readFile(tracePath, "utf8")).trim().split("\n");
      const record = JSON.parse(traceLines[0] ?? "") as {
        files: unknown[];
        metadata?: {
          session?: {
            observedTools?: Array<{
              tool?: string;
              callID?: string;
              strategy?: string;
              metadata?: { path?: string; offset?: number; limit?: number };
              budget?: { maxBytes?: number; usedBytes?: number };
            }>;
          };
        };
      };
      const observedTool = record.metadata?.session?.observedTools?.[0];

      expect(traceLines).toHaveLength(1);
      expect(record.files).toEqual([]);
      expect(observedTool).toMatchObject({
        tool: "read",
        callID: "call-read-1",
        strategy: "path-only",
        metadata: {
          path: "src/example.ts",
          offset: 1,
          limit: 20,
        },
        budget: {
          maxBytes: readClassification.capture.budget.byteLimit,
        },
      });
      expect(observedTool?.budget?.usedBytes).toBeGreaterThan(0);
      expect(observedTool?.budget?.usedBytes).toBeLessThanOrEqual(
        observedTool?.budget?.maxBytes ?? 0,
      );

      const evidence = await loadLocalPathEvidence({
        rootDir: harness.rootDir,
        path: "src/example.ts",
      });

      expect(evidence.sources.messages).toMatchObject({
        status: "unavailable",
        code: "directory_missing",
      });
      expect(evidence.sources.workItems).toMatchObject({
        status: "unavailable",
        code: "directory_missing",
      });
      expect(evidence.sources.traces).toMatchObject({
        status: "available",
        totalMatches: 1,
      });
      expect(evidence.ranked.items).toMatchObject([
        expect.objectContaining({
          kind: "trace",
          matchedPath: "src/example.ts",
          observedTool: "read",
          strategy: "path-only",
          ranges: [],
        }),
      ]);

      const state = sessionStore.get(sessionID);
      expect(
        state?.budgets.ledgers[FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.captureItems],
      ).toMatchObject({
        used: 1,
        limit: readClassification.capture.budget.itemLimit,
        unit: "count",
      });
      expect(
        state?.budgets.ledgers[FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.captureBytes],
      ).toMatchObject({
        limit: readClassification.capture.budget.byteLimit,
        unit: "bytes",
      });
      expect(
        state?.budgets.ledgers[FRAMEWORK_AMBIENT_BUDGET_LEDGER_KEYS.captureBytes]?.used,
      ).toBeGreaterThan(0);
    } finally {
      await harness.cleanup();
    }
  });

  it("skips compaction context for empty kernel state", async () => {
    const sessionStore = createSessionKernelStore();
    const hook = createFrameworkCompactionContextHook(sessionStore);
    const output = { context: [] as string[] };

    await hook({ sessionID: "session-empty" }, output);

    expect(output.context).toEqual([]);
    expect(
      renderFrameworkCompactionContext(
        createSessionKernelState("session-empty", { now: "2026-03-18T08:00:00.000Z" }),
      ),
    ).toBe("");
  });

  it("renders bounded compaction context from populated kernel state and dedupes repeats", async () => {
    const sessionStore = createSessionKernelStore({ now: () => "2026-03-18T08:10:00.000Z" });
    const state = createSessionKernelState("session-compaction-1", {
      now: "2026-03-18T08:09:00.000Z",
      promptContext: {
        role: "user",
        agent: "builder",
        model: { providerID: "openai", modelID: "gpt-5.4" },
        variant: "careful",
        tools: { edit: false, read: true, task: true },
      },
      metadata: {
        policyRuntime: {
          completedInjectOnlyRules: ["guidance"],
          confirmedSkills: ["policy-toml-guardrails", "sdlc"],
        },
      },
    });

    state.locks.active["policy-pending-override"] = {
      scope: "mutating-tools",
      reason: "Need explicit human review before continuing.",
      source: "groundwork-policy",
      createdAt: "2026-03-18T08:09:01.000Z",
      paths: ["infra/prod/main.tf"],
    };
    state.pendingTools.calls["call-1"] = {
      callID: "call-1",
      toolName: "edit_file",
      phase: "after",
      capturedAt: "2026-03-18T08:09:02.000Z",
      targets: [{ path: "src/main.ts", normalizedPath: "src/main.ts" }],
    };
    rememberFrameworkAction(state, {
      now: "2026-03-18T08:09:03.000Z",
      source: "context",
      action: "inject-file",
      parts: ["/repo/AGENTS.md"],
      metadata: {
        path: "/repo/AGENTS.md",
        fileName: "AGENTS.md",
      },
    });
    rememberFrameworkAction(state, {
      now: "2026-03-18T08:09:04.000Z",
      source: "context",
      action: "inject-file",
      parts: ["/repo/packages/feature/CLAUDE.md"],
      metadata: {
        path: "/repo/packages/feature/CLAUDE.md",
        fileName: "CLAUDE.md",
      },
    });
    sessionStore.set(state);

    const hook = createFrameworkCompactionContextHook(sessionStore);
    const output = { context: [] as string[] };

    await hook({ sessionID: "session-compaction-1" }, output);
    await hook({ sessionID: "session-compaction-1" }, output);

    expect(output.context).toHaveLength(1);
    expect(output.context[0]).toBe(
      renderFrameworkCompactionContext(sessionStore.get("session-compaction-1")!),
    );
    expect(output.context[0]).toMatchInlineSnapshot(`
      "Groundwork context:
      - context: injected files /repo/AGENTS.md, /repo/packages/feature/CLAUDE.md
      - policy: active locks policy-pending-override (mutating-tools); confirmed skills policy-toml-guardrails, sdlc; completed prompt-only rules guidance
      - provenance: prompt role=user agent=builder model=openai/gpt-5.4 variant=careful tools edit=false, read=true, task=true; pending tools edit_file(src/main.ts)"
    `);
    expect(Buffer.byteLength(output.context[0] ?? "", "utf8")).toBeLessThanOrEqual(
      FRAMEWORK_COMPACTION_CONTEXT_MAX_BYTES,
    );
  });

  it("preserves shared context and policy state through plugin compaction", async () => {
    const globalConfig = path.join(
      os.tmpdir(),
      `groundwork-global-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`,
    );
    const harness = await createFrameworkHookHarness({
      createHooks: async (context) => {
        await writePolicy(
          context.directory,
          `version = 1

[[rules]]
id = "guidance"
match = ["src/**"]

[[rules.actions]]
type = "inject_prompt"
text = "stay within guardrails"
`,
        );

        const previousGlobalConfig = process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG;
        process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG = globalConfig;

        try {
          return await GroundworkPlugin(context);
        } finally {
          if (previousGlobalConfig === undefined) {
            delete process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG;
          } else {
            process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG = previousGlobalConfig;
          }
        }
      },
    });

    try {
      const parentPath = path.join(harness.rootDir, "packages", "AGENTS.md");
      const childPath = path.join(harness.rootDir, "packages", "feature", "CLAUDE.md");

      await writeText(parentPath, "Parent context guidance");
      await writeText(childPath, "Child context guidance");

      await harness.invokeChatMessage(
        { sessionID: "session-compaction-2" },
        { parts: [{ type: "text", text: "/policy skill-loaded sdlc" }] },
      );
      await harness.invokeToolBefore(
        {
          tool: "read",
          callID: "session-compaction-2-read",
          sessionID: "session-compaction-2",
        },
        { filePath: "packages/feature/src/index.ts" },
      );
      await harness.invokeToolAfter({
        tool: "read",
        callID: "session-compaction-2-read",
        sessionID: "session-compaction-2",
      });

      const compactionOutput = { context: [] as string[] };
      await harness.invokeHook(
        "experimental.session.compacting",
        { sessionID: "session-compaction-2" },
        compactionOutput,
      );
      await harness.invokeHook(
        "experimental.session.compacting",
        { sessionID: "session-compaction-2" },
        compactionOutput,
      );

      expect(compactionOutput.context).toHaveLength(1);
      expect(compactionOutput.context[0]).toContain("context: injected files");
      expect(compactionOutput.context[0]).toContain(parentPath);
      expect(compactionOutput.context[0]).toContain(childPath);
      expect(compactionOutput.context[0]).toContain("confirmed skills sdlc");
      expect(compactionOutput.context[0]).toContain(
        "provenance: prompt role=user agent=builder model=openai/gpt-5.4 variant=careful",
      );
    } finally {
      await harness.cleanup();
    }
  });
});

async function writePolicy(root: string, policyToml: string): Promise<void> {
  const policyPath = path.join(root, ".opencode", "policy.toml");
  await fs.mkdir(path.dirname(policyPath), { recursive: true });
  await fs.writeFile(policyPath, policyToml, "utf8");
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
