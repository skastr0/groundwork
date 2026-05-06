import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadLocalPathEvidence,
  loadLocalSpanTraceEvidence,
  toProvenanceEvidenceSources,
} from "../provenance/tooling/evidence/index.ts";

const longSummary = "Evidence ".repeat(60);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const repoMessagesDir = path.join(repoRoot, ".agents", "messages");
const PROVENANCE_REGISTRY_PATH = "plugin/groundwork/provenance/registry.ts";
const HISTORICAL_EVIDENCE_PATH = "plugin/provenance-tools/evidence/index.ts";
const HISTORICAL_EXPAND_PATH = "plugin/provenance-tools/expand/index.ts";

async function copyRepoMessageFixture(tempRoot: string, fileName: string): Promise<void> {
  const targetDirectory = path.join(tempRoot, ".agents", "messages");
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.copyFile(path.join(repoMessagesDir, fileName), path.join(targetDirectory, fileName));
}

async function loadMessageSource(tempRoot: string, targetPath: string) {
  const result = await loadLocalPathEvidence({
    rootDir: tempRoot,
    path: targetPath,
    includeTraces: false,
    includeWorkItems: false,
  });

  expect(result.sources.messages.status).toBe("available");
  if (result.sources.messages.status !== "available") {
    throw new Error("expected messages source to be available");
  }

  return result.sources.messages;
}

describe("loadLocalPathEvidence", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "prov-evidence-"));
  });

  afterEach(async () => {
    if (!tempRoot) return;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("loads bounded message, work-item, and trace evidence with deterministic ranking", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".agents", "traces"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".agents", "sdlc", "building"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".agents", "sdlc", "done"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, ".agents", "sdlc", "building", "example-building.md"),
      `# Active Example\n\n` +
        `id: example-building\n\n` +
        `## Context\nTouch src/example.ts now.\n\n` +
        `## Acceptance Criteria\n- [ ] Update src/example.ts\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "sdlc", "done", "example-done.md"),
      `# Done Example\n\n` +
        `id: example-done\n\n` +
        `## Context\nHistorical note about src/example.ts.\n\n` +
        `## Acceptance Criteria\n- [x] Ship src/example.ts\n`,
      "utf8",
    );

    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T10-00-00Z-build.json"),
      JSON.stringify(
        {
          from: "builder",
          phase: "build",
          type: "implementation",
          content: {
            summary: `Updated src/example.ts. ${longSummary}`,
          },
          metadata: {
            timestamp: "2026-05-30T10:00:00Z",
            schema_id: "sdlc-core/implementation/v1",
            work_item_ref: {
              plugin: "sdlc-core",
              id: "example-building",
              path: ".agents/sdlc/building/example-building.md",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T10-00-00Z-review.json"),
      JSON.stringify(
        {
          from: "reviewer",
          phase: "review",
          type: "findings",
          content: {
            summary: "example-building follow-up",
          },
          metadata: {
            timestamp: "2026-05-30T10:00:00Z",
            schema_id: "sdlc-core/review-findings/v1",
            work_item_ref: {
              plugin: "sdlc-core",
              id: "example-building",
              path: ".agents/sdlc/building/example-building.md",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T10-00-00Z-old.json"),
      JSON.stringify(
        {
          from: "builder",
          phase: "build",
          type: "implementation",
          content: {
            summary: "Earlier src/example.ts note",
          },
          metadata: {
            timestamp: "2026-05-30T10:00:00Z",
            schema_id: "sdlc-core/implementation/v1",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await fs.writeFile(
      path.join(tempRoot, ".agents", "traces", "session-session-1.jsonl"),
      `${JSON.stringify({
        version: "0.1.0",
        id: "trace-1",
        timestamp: "2026-05-30T10:30:00Z",
        vcs: { type: "git", revision: "abc123" },
        files: [
          {
            path: "src/example.ts",
            conversations: [
              {
                ranges: [{ start_line: 4, end_line: 8, content_hash: "hash-1" }],
              },
            ],
          },
        ],
        metadata: {
          session: { sessionID: "session-1" },
          session_context: {
            agent: "builder",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
        },
      })}\n`,
      "utf8",
    );

    const result = await loadLocalPathEvidence({
      rootDir: tempRoot,
      path: "src/example.ts",
      perSourceLimit: 2,
      maxItems: 5,
      maxBytes: 600,
    });

    expect(result.sources.traces.status).toBe("available");
    expect(result.sources.workItems.status).toBe("available");
    expect(result.sources.messages.status).toBe("available");
    expect(
      result.sources.messages.status === "available" && result.sources.messages.totalMatches,
    ).toBe(3);
    expect(
      result.sources.messages.status === "available" && result.sources.messages.bounds,
    ).toMatchObject({
      returned: 2,
      truncated: true,
    });
    expect(result.ranked.items.length).toBeGreaterThan(0);
    expect(result.ranked.items[0]?.kind).toBe("trace");
    expect(result.ranked.bounds.truncated).toBe(true);
    expect(result.ranked.bytes.truncated).toBe(true);
  });

  it("returns explicit unavailable and unsupported states instead of omitting sources", async () => {
    const result = await loadLocalPathEvidence({
      rootDir: tempRoot,
      path: "src/missing.ts",
      includeWorkItems: false,
    });

    expect(result.sources.messages).toMatchObject({
      status: "unavailable",
      code: "directory_missing",
    });
    expect(result.sources.workItems).toMatchObject({
      status: "unsupported",
      code: "disabled_by_caller",
    });
    expect(result.sources.traces).toMatchObject({
      status: "unavailable",
      code: "directory_missing",
    });
    expect(result.ranked.items).toEqual([]);
  });

  it("surfaces metadata-only read traces through the shared evidence service", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "traces"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, ".agents", "traces", "session-observed.jsonl"),
      `${JSON.stringify({
        version: "0.1.0",
        id: "trace-observed-read",
        timestamp: "2026-05-30T10:15:00Z",
        files: [],
        metadata: {
          session: {
            sessionID: "session-observed",
            observedTools: [
              {
                tool: "read",
                callID: "call-read",
                capturedAt: "2026-05-30T10:15:00Z",
                strategy: "path-only",
                metadata: {
                  path: "src/example.ts",
                  offset: 4,
                  limit: 12,
                },
                budget: {
                  maxBytes: 512,
                  usedBytes: 96,
                },
              },
            ],
          },
        },
      })}\n`,
      "utf8",
    );

    const result = await loadLocalPathEvidence({
      rootDir: tempRoot,
      path: "src/example.ts",
      includeMessages: false,
      includeWorkItems: false,
    });

    expect(result.sources.messages).toMatchObject({
      status: "unsupported",
      code: "disabled_by_caller",
    });
    expect(result.sources.workItems).toMatchObject({
      status: "unsupported",
      code: "disabled_by_caller",
    });
    expect(result.sources.traces).toMatchObject({
      status: "available",
      totalMatches: 1,
    });
    expect(result.ranked.items).toMatchObject([
      expect.objectContaining({
        kind: "trace",
        matchedPath: "src/example.ts",
        observedTool: "read",
        strategy: "path-only",
        ranges: [],
      }),
    ]);
  });

  it("can surface message evidence through linked work items and convert ranked items to provenance sources", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });
    await fs.mkdir(path.join(tempRoot, ".agents", "sdlc", "done"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, ".agents", "sdlc", "done", "example-work-item.md"),
      `# Example Work Item\n\n` +
        `id: example-work-item\n\n` +
        `## Context\nTrack src/example.ts through review.\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T11-00-00Z-build.json"),
      JSON.stringify(
        {
          from: "builder",
          phase: "build",
          type: "implementation",
          content: {
            summary: "Implemented the requested follow-up",
          },
          metadata: {
            timestamp: "2026-05-30T11:00:00Z",
            schema_id: "sdlc-core/implementation/v1",
            work_item_ref: {
              plugin: "sdlc-core",
              id: "example-work-item",
              path: ".agents/sdlc/done/example-work-item.md",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await loadLocalPathEvidence({
      rootDir: tempRoot,
      path: "src/example.ts",
      includeTraces: false,
    });

    expect(result.sources.messages.status).toBe("available");
    if (result.sources.messages.status !== "available") {
      throw new Error("expected messages source to be available");
    }

    expect(result.sources.messages.items[0]?.linkedWorkItemID).toBe("example-work-item");

    const sources = toProvenanceEvidenceSources(result.ranked.items);
    expect(sources.map((source) => source.kind)).toEqual(["work_item", "message"]);
    expect(sources[1]).toMatchObject({
      kind: "message",
      path: ".agents/messages/2026-05-30T11-00-00Z-build.json",
    });
  });

  it("falls back to raw packet artifacts when canonical packets omit string summaries", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T12-30-00Z-review.json"),
      JSON.stringify(
        {
          from: "reviewer",
          phase: "review",
          type: "findings",
          content: {
            summary: {
              assessment: `Structured review assessment for ${PROVENANCE_REGISTRY_PATH}.`,
            },
            findings: [
              {
                file: PROVENANCE_REGISTRY_PATH,
              },
            ],
          },
          metadata: {
            timestamp: "2026-05-30T12:30:00Z",
            schema_id: "sdlc-core/review-findings/v1",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await loadLocalPathEvidence({
      rootDir: tempRoot,
      path: PROVENANCE_REGISTRY_PATH,
      includeTraces: false,
      includeWorkItems: false,
    });

    expect(result.sources.messages.status).toBe("available");
    if (result.sources.messages.status !== "available") {
      throw new Error("expected messages source to be available");
    }

    expect(result.sources.messages.items[0]).toMatchObject({
      phase: "review",
      type: "findings",
      summary: "Packet artifact: 2026-05-30T12-30-00Z-review.json",
    });
    expect(result.sources.messages.warnings).toContainEqual(
      expect.objectContaining({ code: "packet_summary_missing" }),
    );
  });

  it("does not expose semantic timestamps for noncanonical packets", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });

    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-05-30T12-35-00Z-legacy.json"),
      JSON.stringify(
        {
          from: "legacy-reviewer",
          phase: "review",
          type: "findings",
          content: {
            summary: `Legacy note for ${PROVENANCE_REGISTRY_PATH}`,
          },
          metadata: {
            timestamp: "2026-05-30T12:35:00Z",
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const messages = await loadMessageSource(tempRoot, PROVENANCE_REGISTRY_PATH);

    expect(messages.items[0]).toMatchObject({
      from: "unknown",
      phase: "unknown",
      type: "unknown",
      timestamp: "",
      summary: "Packet artifact: 2026-05-30T12-35-00Z-legacy.json",
    });
    expect(messages.warnings).toContainEqual(
      expect.objectContaining({ code: "packet_envelope_noncanonical" }),
    );
  });

  it("surfaces legacy repo packet fixtures as raw artifacts under canonical-only policy", async () => {
    await copyRepoMessageFixture(tempRoot, "2026-05-30T13-52-14Z-build-implementation.json");
    await copyRepoMessageFixture(
      tempRoot,
      "2026-05-30T15-35-00Z-review-prv-09-prov-diff-and-commit-tools.md-simplicity-reviewer.json",
    );
    await copyRepoMessageFixture(
      tempRoot,
      "2026-03-18T05-16-00Z-review-epi-14-risk-bash-adapter-security-reviewer.json",
    );
    await copyRepoMessageFixture(
      tempRoot,
      "2026-03-18T07-27-57-681Z-policy-guardrail-typescript-no-pick-narrowing.json",
    );

    const directSummary = await loadMessageSource(tempRoot, HISTORICAL_EVIDENCE_PATH);
    expect(directSummary.items[0]).toMatchObject({
      phase: "unknown",
      type: "unknown",
      summary: "Packet artifact: 2026-05-30T13-52-14Z-build-implementation.json",
    });
    expect(directSummary.warnings).toContainEqual(
      expect.objectContaining({ code: "packet_envelope_noncanonical" }),
    );

    const nestedSummary = await loadMessageSource(tempRoot, HISTORICAL_EXPAND_PATH);
    expect(nestedSummary.items[0]).toMatchObject({
      phase: "unknown",
      type: "unknown",
      summary:
        "Packet artifact: 2026-05-30T15-35-00Z-review-prv-09-prov-diff-and-commit-tools.md-simplicity-reviewer.json",
    });
    expect(nestedSummary.warnings).toContainEqual(
      expect.objectContaining({ code: "packet_envelope_noncanonical" }),
    );

    const objectSummary = await loadMessageSource(
      tempRoot,
      "plugin/groundwork/risk/runtime.ts",
    );
    expect(objectSummary.items[0]).toMatchObject({
      phase: "unknown",
      type: "unknown",
      summary:
        "Packet artifact: 2026-03-18T05-16-00Z-review-epi-14-risk-bash-adapter-security-reviewer.json",
    });
    expect(objectSummary.warnings).toContainEqual(
      expect.objectContaining({ code: "packet_envelope_noncanonical" }),
    );

    const inferredSummary = await loadMessageSource(
      tempRoot,
      "plugin/groundwork/provenance/runtime.ts",
    );
    expect(inferredSummary.items[0]).toMatchObject({
      phase: "unknown",
      type: "unknown",
      summary:
        "Packet artifact: 2026-03-18T07-27-57-681Z-policy-guardrail-typescript-no-pick-narrowing.json",
    });
    expect(inferredSummary.warnings).toContainEqual(
      expect.objectContaining({ code: "packet_envelope_noncanonical" }),
    );
  });

  it("fails soft on unreadable real packet fixtures with explicit warnings", async () => {
    await copyRepoMessageFixture(tempRoot, "2026-05-30T13-52-14Z-build-implementation.json");
    await copyRepoMessageFixture(
      tempRoot,
      "2026-03-18T04-26-00Z-review-epi-12-policy-parity-fixtures-reviewer.json",
    );

    const messages = await loadMessageSource(tempRoot, HISTORICAL_EVIDENCE_PATH);

    expect(messages.items[0]).toMatchObject({
      phase: "unknown",
      type: "unknown",
      summary: "Packet artifact: 2026-05-30T13-52-14Z-build-implementation.json",
    });
    expect(messages.warnings).toContainEqual(
      expect.objectContaining({ code: "packet_envelope_noncanonical" }),
    );
    expect(messages.warnings).toContainEqual(
      expect.objectContaining({
        code: "invalid_packet_json",
        message:
          "Skipped unreadable packet '2026-03-18T04-26-00Z-review-epi-12-policy-parity-fixtures-reviewer.json'.",
      }),
    );
  });

  it("returns unavailable span trace evidence when traces are missing", async () => {
    const result = await loadLocalSpanTraceEvidence({
      rootDir: tempRoot,
      path: "src/example.ts",
      startLine: 5,
      endLine: 6,
    });

    expect(result.anchor).toMatchObject({
      path: "src/example.ts",
      aliases: expect.arrayContaining(["src/example.ts"]),
    });
    expect(result.span).toEqual({
      startLine: 5,
      endLine: 6,
    });
    expect(result.source).toMatchObject({
      source: "traces",
      directory: ".agents/traces",
      status: "unavailable",
      code: "directory_missing",
    });
  });

  it("returns exact span trace matches for traced ranges", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "traces"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, ".agents", "traces", "session-span.jsonl"),
      `${JSON.stringify({
        version: "0.1.0",
        id: "trace-span",
        timestamp: "2026-05-30T12:00:00Z",
        files: [
          {
            path: "src/example.ts",
            conversations: [
              {
                contributor: { type: "ai", model_id: "openai/gpt-5.4" },
                ranges: [
                  {
                    start_line: 4,
                    end_line: 8,
                    content_hash: "hash-span",
                    contributor: { type: "ai", model_id: "openai/gpt-5.4" },
                  },
                ],
              },
            ],
          },
        ],
        metadata: {
          session: { sessionID: "session-span" },
          session_context: {
            agent: "builder",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
        },
      })}\n`,
      "utf8",
    );

    const result = await loadLocalSpanTraceEvidence({
      rootDir: tempRoot,
      path: "src/example.ts",
      startLine: 5,
      endLine: 6,
    });

    expect(result.source).toMatchObject({
      status: "available",
      matchMode: "exact",
      exactMatches: 1,
      items: [
        expect.objectContaining({
          matchKind: "exact_span",
          confidence: "high",
          contributor: {
            type: "ai",
            modelID: "openai/gpt-5.4",
          },
          ranges: [
            expect.objectContaining({
              startLine: 4,
              endLine: 8,
              overlapStartLine: 5,
              overlapEndLine: 6,
            }),
          ],
        }),
      ],
    });
  });

  it("returns heuristic path-only trace matches for untraced ranges", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "traces"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, ".agents", "traces", "session-heuristic.jsonl"),
      `${JSON.stringify({
        version: "0.1.0",
        id: "trace-heuristic",
        timestamp: "2026-05-30T12:30:00Z",
        files: [
          {
            path: "src/example.ts",
            conversations: [
              {
                contributor: { type: "ai", model_id: "openai/gpt-5.4" },
                ranges: [{ start_line: 4, end_line: 8, content_hash: "hash-heuristic" }],
              },
            ],
          },
        ],
        metadata: {
          session: { sessionID: "session-heuristic" },
          session_context: {
            agent: "builder",
            model: { providerID: "openai", modelID: "gpt-5.4" },
          },
        },
      })}\n`,
      "utf8",
    );

    const result = await loadLocalSpanTraceEvidence({
      rootDir: tempRoot,
      path: "src/example.ts",
      startLine: 20,
      endLine: 22,
    });

    expect(result.source).toMatchObject({
      status: "available",
      matchMode: "heuristic",
      exactMatches: 0,
      heuristicMatches: 1,
      items: [
        expect.objectContaining({
          matchKind: "path_only",
          confidence: "low",
          heuristic: true,
        }),
      ],
    });
  });
});
