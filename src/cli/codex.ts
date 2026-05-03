import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { configFromEnv } from "../risk/rules.ts";
import { evaluateRiskCommand } from "../risk/service.ts";

export const CodexInstallProjectInputSchema = z
  .object({
    target_dir: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export const CodexInstallUserInputSchema = z
  .object({
    codex_home: z.string().min(1).optional(),
    force: z.boolean().optional(),
  })
  .strict();

export type CodexInstallProjectInput = z.infer<typeof CodexInstallProjectInputSchema>;
export type CodexInstallUserInput = z.infer<typeof CodexInstallUserInputSchema>;

export async function renderCodexDoctor() {
  const cwd = process.cwd();
  const projectCodexDir = path.join(cwd, ".codex");
  const pluginManifestPath = path.join(cwd, ".codex-plugin", "plugin.json");
  const bundledSkillPath = path.join(cwd, "skills", "groundwork", "SKILL.md");
  const bundledHooksPath = path.join(cwd, "hooks", "hooks.json");

  return {
    integration: "codex",
    status: "ok",
    checks: [
      await fileCheck("plugin.manifest", pluginManifestPath),
      await fileCheck("plugin.skill.groundwork", bundledSkillPath),
      await fileCheck("plugin.hooks", bundledHooksPath),
      await fileCheck("project.codex_dir", projectCodexDir),
    ],
    limitations: codexLimitations(),
  };
}

export async function installCodexProject(input: CodexInstallProjectInput) {
  const targetDir = path.resolve(input.target_dir ?? process.cwd());
  const codexDir = path.join(targetDir, ".codex");
  const hooksDir = path.join(codexDir, "hooks");
  const skillsDir = path.join(codexDir, "skills", "groundwork");

  await fs.mkdir(hooksDir, { recursive: true });
  await fs.mkdir(skillsDir, { recursive: true });

  const configPath = path.join(codexDir, "config.toml");
  const hooksPath = path.join(codexDir, "hooks.json");
  const skillPath = path.join(skillsDir, "SKILL.md");

  const writes = [
    await ensureCodexHooksFeature(configPath),
    await writeFileIfAllowed(hooksPath, `${JSON.stringify(codexHooksConfig(), null, 2)}\n`, input.force ?? false),
    await writeFileIfAllowed(skillPath, groundworkSkillMarkdown(), input.force ?? false),
  ];

  return {
    target_dir: targetDir,
    codex_dir: codexDir,
    files: writes,
    limitations: codexLimitations(),
  };
}

export async function installCodexUser(input: CodexInstallUserInput) {
  const codexHome = path.resolve(input.codex_home ?? process.env["CODEX_HOME"] ?? path.join(os.homedir(), ".codex"));
  const configPath = path.join(codexHome, "config.toml");
  const hooksPath = path.join(codexHome, "hooks.json");
  const skillsDir = path.join(codexHome, "skills", "groundwork");
  const skillPath = path.join(skillsDir, "SKILL.md");

  await fs.mkdir(skillsDir, { recursive: true });

  const writes = [
    await ensureCodexHooksFeature(configPath),
    await writeFileIfAllowed(hooksPath, `${JSON.stringify(codexHooksConfig(), null, 2)}\n`, input.force ?? false),
    await writeFileIfAllowed(skillPath, groundworkSkillMarkdown(), input.force ?? false),
  ];

  return {
    codex_home: codexHome,
    files: writes,
    limitations: codexLimitations(),
  };
}

export async function runCodexHook() {
  const payload = await new Response(Bun.stdin.stream()).json();
  const eventName = stringField(payload, "hook_event_name");

  if (eventName === "SessionStart") {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: sessionStartContext(),
        },
      })}\n`,
    );
    return;
  }

  if (eventName === "PreToolUse" && stringField(payload, "tool_name") === "Bash") {
    const command = commandFromHookPayload(payload);
    if (!command) {
      return;
    }
    const config = configFromEnv(process.env);
    const decision = evaluateRiskCommand({ command, config });
    if (decision.violation) {
      if (decision.decision === "warn") {
        process.stdout.write(
          `${JSON.stringify({
            systemMessage: `[groundwork:risk] Warn mode matched ${decision.violation.ruleId}: ${decision.violation.reason}`,
          })}\n`,
        );
        return;
      }

      process.stdout.write(
        `${JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: `[groundwork:risk] ${decision.violation.reason}`,
          },
        })}\n`,
      );
    }
  }
}

function codexHooksConfig() {
  return {
    hooks: {
      SessionStart: [
        {
          matcher: "startup|resume|clear",
          hooks: [
            {
              type: "command",
              command: "groundwork codex hook",
              timeout: 30,
              statusMessage: "Loading Groundwork guidance",
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "^Bash$",
          hooks: [
            {
              type: "command",
              command: "groundwork codex hook",
              timeout: 30,
              statusMessage: "Checking Groundwork risk policy",
            },
          ],
        },
      ],
    },
  };
}

function groundworkSkillMarkdown(): string {
  return `---
name: groundwork
description: Use Groundwork for policy, provenance, context, and risk guardrails through the JSON-first groundwork CLI.
---

# Groundwork

Use the \`groundwork\` CLI when you need policy, provenance, context, or risk evidence.

Core commands:

- \`groundwork doctor\`
- \`groundwork capabilities\`
- \`groundwork schema list\`
- \`groundwork examples list\`
- \`groundwork risk evaluate-command '{"command":"git reset --hard"}'\`
- \`groundwork context discover '{"target_path":"src/index.ts"}'\`
- \`groundwork provenance repo-state '{"limit":10}'\`
- \`groundwork provenance file-state '{"path":"src/index.ts"}'\`

Codex hooks are best-effort guardrails. They can deny supported Bash calls through \`PreToolUse\`, but they do not intercept every tool path and cannot inject tool-triggered synthetic prompts with full OpenCode parity.
`;
}

function sessionStartContext(): string {
  return [
    "Groundwork is available through the `groundwork` CLI for policy, provenance, context, and risk evidence.",
    "Prefer JSON CLI calls over ad hoc reasoning when checking risky shell commands, inherited context files, or local git state.",
    "Codex hooks are best-effort guardrails; they do not cover every tool path and do not provide full OpenCode prompt-injection parity.",
  ].join("\n");
}

function codexLimitations() {
  return [
    "Project-local hooks load only for trusted projects.",
    "PreToolUse denial only covers supported Codex tool calls.",
    "PostToolUse cannot undo side effects.",
    "Tool-triggered synthetic prompt injection is unsupported in V1.",
  ];
}

async function fileCheck(name: string, filePath: string) {
  try {
    await fs.access(filePath);
    return { name, ok: true, path: filePath };
  } catch {
    return { name, ok: false, path: filePath };
  }
}

async function writeFileIfAllowed(filePath: string, content: string, force: boolean) {
  const exists = await fileExists(filePath);
  if (exists && !force) {
    return { path: filePath, action: "skipped", reason: "exists" };
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return { path: filePath, action: exists ? "overwritten" : "created" };
}

async function ensureCodexHooksFeature(configPath: string) {
  const exists = await fileExists(configPath);
  if (!exists) {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, initialConfigToml(), "utf8");
    return { path: configPath, action: "created" };
  }

  const original = await fs.readFile(configPath, "utf8");
  const patched = patchCodexHooksFeature(original);
  if (patched === original) {
    return { path: configPath, action: "unchanged" };
  }

  await fs.writeFile(configPath, patched, "utf8");
  return { path: configPath, action: "patched" };
}

function initialConfigToml(): string {
  return [
    "# Groundwork Codex integration",
    "# Project hooks load only when this project is trusted by Codex.",
    "[features]",
    "codex_hooks = true",
    "",
  ].join("\n");
}

function patchCodexHooksFeature(config: string): string {
  const lines = config.split(/\r?\n/);
  const featuresStart = lines.findIndex((line) => line.trim() === "[features]");
  if (featuresStart === -1) {
    return appendBlock(config, ["[features]", "codex_hooks = true"]);
  }

  let insertAt = lines.length;
  for (let index = featuresStart + 1; index < lines.length; index += 1) {
    if (/^\s*\[/.test(lines[index] ?? "")) {
      insertAt = index;
      break;
    }
    if (/^\s*codex_hooks\s*=/.test(lines[index] ?? "")) {
      lines[index] = "codex_hooks = true";
      return ensureTrailingNewline(lines.join("\n"));
    }
  }

  lines.splice(insertAt, 0, "codex_hooks = true");
  return ensureTrailingNewline(lines.join("\n"));
}

function appendBlock(config: string, block: string[]): string {
  const prefix = config.trim().length === 0 ? "" : ensureTrailingNewline(config);
  return `${prefix}${prefix.endsWith("\n\n") || prefix.length === 0 ? "" : "\n"}${block.join("\n")}\n`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" ? field : undefined;
}

function commandFromHookPayload(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const input = (value as Record<string, unknown>)["tool_input"];
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const command = (input as Record<string, unknown>)["command"];
  return typeof command === "string" ? command : undefined;
}
