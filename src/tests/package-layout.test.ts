import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readPackageJson(packagePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(repoRoot, packagePath, "package.json"), "utf8"));
}

describe("groundwork package layout", () => {
  it("keeps the CLI, core, and Prism plugin surfaces in place", async () => {
    await fs.access(path.join(repoRoot, "src", "cli.ts"));
    await fs.access(path.join(repoRoot, "packages", "core", "src", "policy", "config.ts"));
    await fs.access(path.join(repoRoot, "packages", "core", "src", "provenance", "registry.ts"));
    await fs.access(path.join(repoRoot, "packages", "core", "src", "portable", "runtime.ts"));
    await fs.access(path.join(repoRoot, "prism-plugin", "plugin.json"));
    await fs.access(path.join(repoRoot, "prism-plugin", "hooks", "tool-before.hook.ts"));
    await fs.access(path.join(repoRoot, "prism-plugin", "tools", "gw_repo_state.tool.ts"));

    const rootPackage = await readPackageJson(".");
    expect(rootPackage["workspaces"]).toEqual(["packages/*"]);
    expect((rootPackage["bin"] as Record<string, string>)["groundwork"]).toBe("dist/cli.js");
    expect(rootPackage["scripts"]).toMatchObject({
      "plugin:package": expect.stringContaining("package-harness-plugins"),
    });
    await fs.access(path.join(repoRoot, "scripts", "package-harness-plugins.ts"));
    await fs.access(path.join(repoRoot, "packages", "codex", ".codex-plugin", "plugin.json"));
    await fs.access(path.join(repoRoot, "packages", "claude-code", ".claude-plugin", "plugin.json"));

    const corePackage = await readPackageJson("packages/core");
    expect(corePackage["name"]).toBe("@skastr0/groundwork-core");
    expect((corePackage["exports"] as Record<string, unknown>)["./portable"]).toBeTruthy();
  });
});
