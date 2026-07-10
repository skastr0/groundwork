import { describe, expect, it } from "vitest";
import {
  normalizePolicyToolName,
  parsePolicyPromptCommands,
  sessionStartResult,
  toolBeforeResult,
} from "../../packages/core/src/portable/index.ts";

describe("portable hook runtime", () => {
  it("sessionStartResult injects guidance", () => {
    const result = sessionStartResult({});
    expect(result.decision).toBe("continue");
    expect(result.additionalContext).toContain("Groundwork is active");
  });

  it("parsePolicyPromptCommands extracts override and skills", () => {
    const commands = parsePolicyPromptCommands(
      "hello\n/policy override because review said so\n/policy skill-loaded groundwork testing\n",
    );
    expect(commands).toEqual([
      { type: "override", reason: "because review said so" },
      { type: "skill-loaded", skills: ["groundwork", "testing"] },
    ]);
  });

  it("normalizePolicyToolName maps Bash and apply_patch", () => {
    expect(normalizePolicyToolName("Bash")).toBe("bash");
    expect(normalizePolicyToolName("apply_patch")).toBe("edit");
    expect(normalizePolicyToolName("Edit")).toBe("edit");
  });

  it("toolBeforeResult blocks force-push without session", async () => {
    const result = await toolBeforeResult({
      toolName: "Bash",
      args: { command: "git push --force origin main" },
    });
    expect(result.decision).toBe("block");
    if (result.decision === "block") {
      expect(result.message).toMatch(/git\.push-force|force/i);
    }
  });
});
