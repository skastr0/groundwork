/**
 * Compile prism-plugin source into shippable harness-native plugin trees.
 *
 * Uses `prism-dev package` (latest Prism) so Groundwork ships Claude/Codex/
 * OpenCode/Grok native install artifacts — users install the harness-native
 * way; they do not run Prism to manage Groundwork.
 */
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile, readdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourcePlugin = path.join(repoRoot, "prism-plugin");
const packageOut = path.join(repoRoot, "packages", "harness-plugins");
/** Shipped native roots live under packages/ so they are repo-accessible and not under gitignored dist/. */
const shipRoot = path.join(repoRoot, "packages");

const HARNESSES = ["claude-code", "codex-cli", "opencode", "grok"] as const;

const resolvePrismDev = async (): Promise<string> => {
  const candidates = [
    process.env.PRISM_DEV_BIN,
    path.join(process.env.HOME ?? "", ".local", "bin", "prism-dev"),
    "prism-dev",
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep) || candidate.startsWith("/")) {
        await access(candidate);
      }
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("prism-dev not found. Install the local Prism binary as prism-dev.");
};

const run = (command: string, args: string[], cwd = repoRoot): Promise<void> =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "?"}`));
    });
  });

const exists = async (target: string): Promise<boolean> =>
  access(target).then(
    () => true,
    () => false,
  );

const rewriteClaudeMcp = async (pluginRoot: string): Promise<void> => {
  const mcpJsonPath = path.join(pluginRoot, ".mcp.json");
  if (!(await exists(mcpJsonPath))) return;
  const mcpConfig = {
    mcpServers: {
      groundwork: {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/mcp/entry-stdio.mjs"],
      },
    },
  };
  await writeFile(mcpJsonPath, `${JSON.stringify(mcpConfig, null, 2)}\n`);
};

const materializeClaude = async (packaged: string): Promise<void> => {
  const nativeSource = path.join(
    packaged,
    "payload",
    "skills",
    "prism-generated-groundwork",
  );
  const dest = path.join(shipRoot, "claude-code"); // packages/claude-code
  await rm(dest, { recursive: true, force: true });
  await cp(nativeSource, dest, { recursive: true });
  const mcpSrc = path.join(packaged, "payload", "mcp", "prism_generated_groundwork");
  if (await exists(mcpSrc)) {
    await cp(mcpSrc, path.join(dest, "mcp"), { recursive: true });
  }
  await rewriteClaudeMcp(dest);
  // Prefer a user-facing package name in the Claude plugin manifest.
  const pluginJsonPath = path.join(dest, ".claude-plugin", "plugin.json");
  if (await exists(pluginJsonPath)) {
    const manifest = JSON.parse(await readFile(pluginJsonPath, "utf8")) as Record<string, unknown>;
    manifest.name = "groundwork";
    manifest.description =
      "Groundwork policy, risk, context, and provenance for Claude Code (Prism-compiled).";
    await writeFile(pluginJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
};

const materializeOpenCode = async (packaged: string): Promise<void> => {
  const nativeSource = path.join(
    packaged,
    "payload",
    "plugins",
    "prism-generated-groundwork",
  );
  const dest = path.join(shipRoot, "opencode-plugin");
  await rm(dest, { recursive: true, force: true });
  await cp(nativeSource, dest, { recursive: true });
  const mcpSrc = path.join(packaged, "payload", "mcp", "prism_generated_groundwork");
  if (await exists(mcpSrc)) {
    await cp(mcpSrc, path.join(dest, "mcp"), { recursive: true });
  }
};

const materializeGrok = async (packaged: string): Promise<void> => {
  const nativeSource = path.join(
    packaged,
    "payload",
    "plugins",
    "prism-generated-groundwork",
  );
  const dest = path.join(shipRoot, "grok");
  await rm(dest, { recursive: true, force: true });
  await cp(nativeSource, dest, { recursive: true });
  const mcpSrc = path.join(packaged, "payload", "mcp", "prism_generated_groundwork");
  if (await exists(mcpSrc)) {
    await cp(mcpSrc, path.join(dest, "mcp"), { recursive: true });
  }
  const pluginJsonPath = path.join(dest, ".claude-plugin", "plugin.json");
  if (await exists(pluginJsonPath)) {
    const manifest = JSON.parse(await readFile(pluginJsonPath, "utf8")) as Record<string, unknown>;
    manifest.name = "groundwork";
    manifest.description =
      "Groundwork policy, risk, context, and provenance for Grok (Prism-compiled).";
    await writeFile(pluginJsonPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
};

const materializeCodex = async (packaged: string): Promise<void> => {
  const dest = path.join(shipRoot, "codex");
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.join(dest, "hooks"), { recursive: true });
  await mkdir(path.join(dest, ".codex-plugin"), { recursive: true });

  const payloadHooks = path.join(packaged, "payload", "hooks");
  if (await exists(payloadHooks)) {
    await cp(payloadHooks, path.join(dest, "hooks"), { recursive: true });
  }
  const payloadSkills = path.join(packaged, "payload", "skills");
  if (await exists(payloadSkills)) {
    await cp(payloadSkills, path.join(dest, "skills"), { recursive: true });
  }
  const mcpSrc = path.join(packaged, "payload", "mcp", "prism_generated_groundwork");
  if (await exists(mcpSrc)) {
    await cp(mcpSrc, path.join(dest, "mcp"), { recursive: true });
  }

  const hookEvents: Array<{ event: string; file: string; matcher?: string }> = [
    { event: "SessionStart", file: "session-start.mjs" },
    { event: "UserPromptSubmit", file: "prompt-submit.mjs" },
    { event: "PreToolUse", file: "tool-before.mjs", matcher: ".*" },
    { event: "PermissionRequest", file: "permission-request.mjs", matcher: ".*" },
    { event: "PostToolUse", file: "tool-after.mjs", matcher: ".*" },
  ];

  const hooksJson: Record<string, unknown> = { hooks: {} as Record<string, unknown[]> };
  for (const entry of hookEvents) {
    const hookPath = path.join(dest, "hooks", entry.file);
    if (!(await exists(hookPath))) continue;
    const hookEntry: Record<string, unknown> = {
      type: "command",
      command: `node "\${PLUGIN_ROOT}/hooks/${entry.file}"`,
      timeout: 30,
      statusMessage: `Groundwork ${entry.event}`,
    };
    const group: Record<string, unknown> = {
      hooks: [hookEntry],
    };
    if (entry.matcher) group.matcher = entry.matcher;
    (hooksJson.hooks as Record<string, unknown[]>)[entry.event] = [group];
  }
  await writeFile(path.join(dest, "hooks", "hooks.json"), `${JSON.stringify(hooksJson, null, 2)}\n`);

  const pluginJson = {
    name: "groundwork",
    version: "0.3.0",
    description: "Groundwork policy, risk, context, and provenance for Codex (Prism-compiled).",
    author: {
      name: "Guilherme Castro",
      email: "skastr052@gmail.com",
      url: "https://github.com/skastr0",
    },
    homepage: "https://github.com/skastr0/groundwork#readme",
    repository: "https://github.com/skastr0/groundwork",
    license: "MIT",
    keywords: ["codex", "groundwork", "policy", "provenance", "risk", "context"],
    hooks: "./hooks/hooks.json",
    interface: {
      displayName: "Groundwork",
      shortDescription: "Policy, provenance, context, and risk feedback.",
      longDescription:
        "Groundwork bundles Codex hooks and provenance tools compiled from the portable Prism plugin.",
      developerName: "Groundwork",
      category: "Productivity",
      websiteURL: "https://github.com/skastr0/groundwork",
      brandColor: "#2563EB",
    },
  };
  await writeFile(
    path.join(dest, ".codex-plugin", "plugin.json"),
    `${JSON.stringify(pluginJson, null, 2)}\n`,
  );

  // Optional package.json for npm publish of the Codex marketplace bundle.
  await writeFile(
    path.join(dest, "package.json"),
    `${JSON.stringify(
      {
        name: "@skastr0/groundwork-codex",
        version: "0.3.0",
        description: "Groundwork Codex plugin (Prism-compiled native bundle)",
        type: "module",
        license: "MIT",
        files: [".codex-plugin", "hooks", "skills", "mcp"],
        publishConfig: { access: "public" },
      },
      null,
      2,
    )}\n`,
  );
};

const writeInstallIndex = async (): Promise<void> => {
  const index = {
    generatedBy: "scripts/package-harness-plugins.ts",
    prism: "prism-dev package",
    source: "prism-plugin/",
    install: {
      "claude-code": {
        path: "packages/claude-code",
        how: "Install as a Claude Code local plugin (contains .claude-plugin/plugin.json).",
      },
      codex: {
        path: "packages/codex",
        how: "Install via Codex marketplace pointing at packages/codex (.codex-plugin/plugin.json).",
      },
      opencode: {
        path: "packages/opencode-plugin",
        how: "Point opencode.json plugin entry at packages/opencode-plugin/dist/server.mjs (file:// URL).",
      },
      grok: {
        path: "packages/grok",
        how: "Install as a Grok local plugin bundle (contains .claude-plugin/plugin.json + hooks).",
      },
    },
  };
  await writeFile(path.join(repoRoot, "packages", "HARNESS_PLUGINS.json"), `${JSON.stringify(index, null, 2)}\n`);
};

const main = async (): Promise<void> => {
  const prismDev = await resolvePrismDev();
  console.log(`Using ${prismDev}`);

  await rm(packageOut, { recursive: true, force: true });
  await mkdir(packageOut, { recursive: true });

  await run(prismDev, [
    "package",
    sourcePlugin,
    `--harness=${HARNESSES.join(",")}`,
    `--out=${packageOut}`,
    "--force",
  ]);

  await materializeClaude(path.join(packageOut, "claude-code", "prism-generated-groundwork"));
  await materializeCodex(path.join(packageOut, "codex-cli", "prism-generated-groundwork"));
  await materializeOpenCode(path.join(packageOut, "opencode", "prism-generated-groundwork"));
  await materializeGrok(path.join(packageOut, "grok", "prism-generated-groundwork"));
  await writeInstallIndex();

  console.log("Shipped native plugins under packages/: claude-code, codex, opencode-plugin, grok");
  console.log("Index: packages/HARNESS_PLUGINS.json");
};

await main();
