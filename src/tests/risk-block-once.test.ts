import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateRiskToolCall,
  evaluateRiskToolResult,
} from "../../packages/core/src/risk/cli-service.ts";

describe("risk block-once session evaluation", () => {
  it("blocks a risky exact command once, then warns and records execution", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-risk-block-once-"));

    try {
      const first = await evaluateRiskToolCall({
        root_dir: rootDir,
        session_id: "risk-session",
        call_id: "risk-call-1",
        command: "git reset --hard",
        cwd: rootDir,
      });

      expect(first).toMatchObject({
        decision: "block",
        effect: "blocked_once",
        violation: { ruleId: "git.reset-hard" },
        messages: [expect.stringContaining("Blocked once for this exact command")],
      });

      const second = await evaluateRiskToolCall({
        root_dir: rootDir,
        session_id: "risk-session",
        call_id: "risk-call-2",
        command: "git reset --hard",
        cwd: rootDir,
      });

      expect(second).toMatchObject({
        decision: "warn",
        effect: "warn_after_block_once",
        violation: { ruleId: "git.reset-hard" },
        messages: [expect.stringContaining("Proceeding after a prior block-once warning")],
      });

      const result = await evaluateRiskToolResult({
        root_dir: rootDir,
        session_id: "risk-session",
        call_id: "risk-call-2",
      });

      expect(result).toMatchObject({
        decision: "warn",
        effect: "warn_after_block_once",
        recorded: true,
        messages: [expect.stringContaining("Unsafe command executed after prior block-once warning")],
      });
      if (!("record" in result) || !result.record) {
        throw new Error("expected risk execution result to include a block-once record");
      }
      expect(result.record?.executionCount).toBe(1);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("treats changed commands and cwd values as new first-risk attempts", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-risk-scope-"));
    const otherDir = path.join(rootDir, "other");
    await fs.mkdir(otherDir);

    try {
      await expect(
        evaluateRiskToolCall({
          root_dir: rootDir,
          session_id: "risk-scope",
          command: "git reset --hard",
          cwd: rootDir,
        }),
      ).resolves.toMatchObject({ decision: "block", effect: "blocked_once" });

      await expect(
        evaluateRiskToolCall({
          root_dir: rootDir,
          session_id: "risk-scope",
          command: "git reset --hard HEAD~1",
          cwd: rootDir,
        }),
      ).resolves.toMatchObject({ decision: "block", effect: "blocked_once" });

      await expect(
        evaluateRiskToolCall({
          root_dir: rootDir,
          session_id: "risk-scope",
          command: "git reset --hard",
          cwd: otherDir,
        }),
      ).resolves.toMatchObject({ decision: "block", effect: "blocked_once" });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("preserves warn and off mode behavior without recording block-once state", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "groundwork-risk-modes-"));

    try {
      await expect(
        evaluateRiskToolCall({
          root_dir: rootDir,
          session_id: "risk-modes",
          command: "git reset --hard",
          cwd: rootDir,
          config: { mode: "warn" },
        }),
      ).resolves.toMatchObject({
        decision: "warn",
        effect: "no_risk",
        violation: { ruleId: "git.reset-hard" },
      });

      await expect(
        evaluateRiskToolCall({
          root_dir: rootDir,
          session_id: "risk-modes",
          command: "git reset --hard",
          cwd: rootDir,
          config: { mode: "off" },
        }),
      ).resolves.toMatchObject({
        decision: "allow",
        effect: "no_risk",
        violation: null,
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});
