import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadLocalPathEvidence } from "../provenance/index.ts";

describe("framework local evidence service", () => {
  let tempRoot = "";

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "framework-local-evidence-"));
  });

  afterEach(async () => {
    if (!tempRoot) return;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("exposes the shared local evidence loader with explicit source states", async () => {
    await fs.mkdir(path.join(tempRoot, ".agents", "messages"), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, ".agents", "messages", "2026-03-18T09-00-00Z-build.json"),
      JSON.stringify(
        {
          from: "builder",
          phase: "build",
          type: "implementation",
          content: {
            summary: "Updated src/example.ts through the framework service",
          },
          metadata: {
            timestamp: "2026-03-18T09:00:00Z",
            schema_id: "sdlc-core/implementation/v1",
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
	      includeWorkItems: false,
	    });

    expect(result.sources.messages).toMatchObject({
      status: "available",
      totalMatches: 1,
    });
    expect(result.sources.workItems).toMatchObject({
      status: "unsupported",
      code: "disabled_by_caller",
    });
    expect(result.ranked.items).toMatchObject([
      expect.objectContaining({
        kind: "message",
        summary: "Updated src/example.ts through the framework service",
      }),
    ]);
  });

  it("bounds message scans and skips oversized packet files", async () => {
    const messagesDir = path.join(tempRoot, ".agents", "messages");
    await fs.mkdir(messagesDir, { recursive: true });

    await fs.writeFile(
      path.join(messagesDir, "000-large.json"),
      JSON.stringify({
        from: "builder",
        phase: "build",
        type: "implementation",
        content: {
          summary: "src/example.ts ".repeat(25_000),
        },
        metadata: {
          timestamp: "2026-03-18T09:00:00Z",
          schema_id: "sdlc-core/implementation/v1",
        },
      }),
      "utf8",
    );

    await fs.writeFile(
      path.join(messagesDir, "001-match.json"),
      JSON.stringify({
        from: "builder",
        phase: "build",
        type: "implementation",
        content: {
          summary: "Updated src/example.ts through bounded scan",
        },
        metadata: {
          timestamp: "2026-03-18T09:01:00Z",
          schema_id: "sdlc-core/implementation/v1",
        },
      }),
      "utf8",
    );

    for (let index = 2; index <= 65; index += 1) {
      const name = `${String(index).padStart(3, "0")}-noise.json`;
      await fs.writeFile(
        path.join(messagesDir, name),
        JSON.stringify({
          from: "builder",
          phase: "build",
          type: "implementation",
          content: {
            summary: `noise-${index}`,
          },
          metadata: {
            timestamp: `2026-03-18T09:${String(index).padStart(2, "0")}:00Z`,
            schema_id: "sdlc-core/implementation/v1",
          },
        }),
        "utf8",
      );
    }

	    const result = await loadLocalPathEvidence({
	      rootDir: tempRoot,
	      path: "src/example.ts",
	      includeWorkItems: false,
	    });

    expect(result.sources.messages.status).toBe("available");
    if (result.sources.messages.status !== "available") {
      throw new Error("expected available message source");
    }

    expect(result.sources.messages.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "message_file_skipped_large" }),
        expect.objectContaining({ code: "message_scan_limited" }),
      ]),
    );
    expect(result.ranked.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          summary: "Updated src/example.ts through bounded scan",
        }),
      ]),
    );
  });
});
