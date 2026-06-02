import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

async function readPackageJson(packagePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(repoRoot, packagePath, "package.json"), "utf8"));
}

describe("groundwork package layout", () => {
  it("keeps the CLI, core, OpenCode, and Codex package surfaces in place", async () => {
    await fs.access(path.join(repoRoot, "src", "cli.ts"));
    await fs.access(path.join(repoRoot, "packages", "core", "src", "policy", "config.ts"));
    await fs.access(path.join(repoRoot, "packages", "core", "src", "provenance", "registry.ts"));
    await fs.access(path.join(repoRoot, "packages", "opencode-plugin", "src", "index.ts"));
    await fs.access(path.join(repoRoot, "packages", "codex", ".codex-plugin", "plugin.json"));
    await fs.access(path.join(repoRoot, "packages", "codex", "hooks", "hooks.json"));

    const rootPackage = await readPackageJson(".");
    expect(rootPackage["workspaces"]).toEqual(["packages/*"]);
    expect((rootPackage["bin"] as Record<string, string>)["groundwork"]).toBe("dist/cli.js");

    const corePackage = await readPackageJson("packages/core");
    expect(corePackage["name"]).toBe("@skastr0/groundwork-core");

    const opencodePackage = await readPackageJson("packages/opencode-plugin");
    expect(opencodePackage["name"]).toBe("@skastr0/groundwork-opencode-plugin");

    const codexPackage = await readPackageJson("packages/codex");
    expect(codexPackage["name"]).toBe("@skastr0/groundwork-codex");
  });
});
