import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLI_ENTRY = path.resolve(process.cwd(), "src", "cli.ts");
const BUN = resolveBun();

async function runHook(subcommand: string, payload: unknown) {
  const proc = spawn(BUN, ["--conditions=development", CLI_ENTRY, "hook", subcommand, JSON.stringify(payload)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");
  proc.stdout.on("data", (c: string) => {
    stdout += c;
  });
  proc.stderr.on("data", (c: string) => {
    stderr += c;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => resolve(code ?? 1));
  });
  return { exitCode, stdout, stderr, json: JSON.parse(stdout) as Record<string, unknown> };
}

function resolveBun(): string {
  if (process.versions.bun) return process.execPath;
  for (const entry of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!entry) continue;
    const candidate = path.join(entry, process.platform === "win32" ? "bun.exe" : "bun");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  return "bun";
}

describe("groundwork hook CLI", () => {
  it("session-start returns additionalContext", async () => {
    const result = await runHook("session-start", {});
    expect(result.exitCode).toBe(0);
    expect(result.json.ok).toBe(true);
    const data = result.json.data as { decision: string; additionalContext?: string };
    expect(data.decision).toBe("continue");
    expect(data.additionalContext).toContain("Groundwork is active");
  });

  it("tool-before blocks destructive shell without session", async () => {
    const result = await runHook("tool-before", {
      tool_name: "Bash",
      args: { command: "git push --force origin main" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.json.ok).toBe(true);
    const data = result.json.data as { decision: string; message?: string };
    expect(data.decision).toBe("block");
    expect(data.message).toMatch(/force/i);
  });
});
