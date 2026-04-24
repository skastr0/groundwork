import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pluginRoot = fileURLToPath(new URL("../../", import.meta.url));

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

describe("epistemology framework single home", () => {
  it("keeps the framework discovery barrel and consolidated home in place", async () => {
    await expect(pathExists(path.join(pluginRoot, "epistemology-framework.ts"))).resolves.toBe(
      true,
    );
    await expect(pathExists(path.join(pluginRoot, "src", "policy", "config.ts"))).resolves.toBe(
      true,
    );
    await expect(
      pathExists(path.join(pluginRoot, "src", "mutation-risk", "rules.ts")),
    ).resolves.toBe(true);
    await expect(
      pathExists(
        path.join(
          pluginRoot,
          "src",
          "provenance",
          "tooling",
          "query",
          "index.ts",
        ),
      ),
    ).resolves.toBe(true);
    await expect(
      pathExists(
        path.join(pluginRoot, "src", "provenance", "trace", "storage.ts"),
      ),
    ).resolves.toBe(true);
  });

  it("does not leave retired plugin homes behind", async () => {
    await expect(pathExists(path.join(pluginRoot, "agent-trace"))).resolves.toBe(false);
    await expect(pathExists(path.join(pluginRoot, "destructive-command-guard"))).resolves.toBe(
      false,
    );
    await expect(pathExists(path.join(pluginRoot, "nested-agents"))).resolves.toBe(false);
    await expect(pathExists(path.join(pluginRoot, "policy-guardrail"))).resolves.toBe(false);
    await expect(pathExists(path.join(pluginRoot, "provenance-tools"))).resolves.toBe(false);

    const entries = await fs.readdir(pluginRoot, { withFileTypes: true });
    expect(
      entries.some((entry) => entry.isDirectory() && entry.name.endsWith("surface-manifest")),
    ).toBe(false);
  });
});
