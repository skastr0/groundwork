import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FRAMEWORK_WORLDVIEW_INJECTION_MAX_BYTES,
  FRAMEWORK_WORLDVIEW_INJECTION_MAX_ITEMS,
} from "../index.ts";
import { createFrameworkHookHarness, createFrameworkMockClient } from "./framework-test-harness.ts";

describe("framework worldview runtime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects parent-first worldview reminders with preserved subagent context", async () => {
    const harness = await createWorldviewPluginHarness({
      sessionMessages: {
        data: [
          {
            info: {
              role: "assistant",
              agent: "ignored",
              model: { providerID: "anthropic", modelID: "claude-sonnet" },
              system: "ignore assistant system",
              tools: { bash: true },
              variant: "fast",
            },
          },
          {
            info: {
              role: "user",
              agent: "explorer",
              model: { providerID: "openai", modelID: "gpt-4.1" },
              system: "preserve worldview context",
              tools: { read: true, edit: false, task: true },
              variant: "deliberate",
            },
          },
        ],
      },
    });

    try {
      const parentPath = path.join(harness.rootDir, "packages", "AGENTS.md");
      const childPath = path.join(harness.rootDir, "packages", "feature", "CLAUDE.md");

      await writeText(parentPath, "Parent worldview guidance");
      await writeText(childPath, "Child worldview guidance");

      await invokeRead(harness, "session-worldview-1", "packages/feature/src/index.ts");

      expect(harness.client.session.prompt).toHaveBeenCalledTimes(1);
      expect(harness.client.session.prompt).toHaveBeenCalledWith({
        path: { id: "session-worldview-1" },
        body: {
          agent: "explorer",
          model: { providerID: "openai", modelID: "gpt-4.1" },
          noReply: true,
          system: "preserve worldview context",
          tools: { read: true, edit: false, task: true },
          variant: "deliberate",
          parts: [
            {
              type: "text",
              text: `<system-reminder>\nInstructions from: ${parentPath}\nParent worldview guidance\n\nInstructions from: ${childPath}\nChild worldview guidance\n</system-reminder>`,
              synthetic: true,
            },
          ],
        },
      });
      expect(harness.client.session.messages).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("reinjects nested worldview instructions after session cleanup without changing prompt context", async () => {
    const sessionID = "session-worldview-cleanup";
    const harness = await createWorldviewPluginHarness({
      sessionMessages: {
        data: [
          {
            info: {
              role: "assistant",
              agent: "ignored",
              model: { providerID: "anthropic", modelID: "claude-sonnet" },
              system: "ignore assistant system",
              tools: { bash: true },
              variant: "fast",
            },
          },
          {
            info: {
              role: "user",
              agent: "explorer",
              model: { providerID: "openai", modelID: "gpt-4.1" },
              system: "preserve worldview context",
              tools: { read: true, edit: false, task: true },
              variant: "deliberate",
            },
          },
          {
            info: {
              role: "user",
              agent: "builder",
              model: { providerID: "openai", modelID: "gpt-5.4" },
              system: "ignore later user prompt",
              tools: { read: false, edit: true },
              variant: "careful",
            },
          },
        ],
      },
    });

    try {
      const parentPath = path.join(harness.rootDir, "packages", "AGENTS.md");
      const childPath = path.join(harness.rootDir, "packages", "feature", "CLAUDE.md");
      const expectedReminder = `<system-reminder>\nInstructions from: ${parentPath}\nParent worldview guidance\n\nInstructions from: ${childPath}\nChild worldview guidance\n</system-reminder>`;

      await writeText(parentPath, "Parent worldview guidance");
      await writeText(childPath, "Child worldview guidance");

      await invokeRead(harness, sessionID, "packages/feature/src/index.ts");
      await harness.cleanupSession(sessionID, "session.deleted");
      await invokeRead(harness, sessionID, "packages/feature/src/index.ts");

      expect(harness.client.session.prompt).toHaveBeenCalledTimes(2);
      expect(harness.client.session.prompt).toHaveBeenNthCalledWith(1, {
        path: { id: sessionID },
        body: {
          agent: "explorer",
          model: { providerID: "openai", modelID: "gpt-4.1" },
          noReply: true,
          system: "preserve worldview context",
          tools: { read: true, edit: false, task: true },
          variant: "deliberate",
          parts: [
            {
              type: "text",
              text: expectedReminder,
              synthetic: true,
            },
          ],
        },
      });
      expect(harness.client.session.prompt).toHaveBeenNthCalledWith(2, {
        path: { id: sessionID },
        body: {
          agent: "explorer",
          model: { providerID: "openai", modelID: "gpt-4.1" },
          noReply: true,
          system: "preserve worldview context",
          tools: { read: true, edit: false, task: true },
          variant: "deliberate",
          parts: [
            {
              type: "text",
              text: expectedReminder,
              synthetic: true,
            },
          ],
        },
      });
      expect(harness.client.session.messages).toHaveBeenCalledTimes(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("dedupes reminders by session and discovered path while allowing deeper new reminders later", async () => {
    const harness = await createWorldviewPluginHarness();

    try {
      const parentPath = path.join(harness.rootDir, "packages", "AGENTS.md");
      const childPath = path.join(harness.rootDir, "packages", "feature", "CLAUDE.md");
      const deepPath = path.join(harness.rootDir, "packages", "feature", "src", "AGENTS.md");

      await writeText(parentPath, "Parent worldview guidance");
      await writeText(childPath, "Child worldview guidance");
      await writeText(deepPath, "Deep worldview guidance");

      await invokeRead(harness, "session-worldview-2", "packages/feature/index.ts");
      await invokeRead(harness, "session-worldview-2", "packages/feature/other.ts");
      await invokeRead(harness, "session-worldview-2", "packages/feature/src/index.ts");

      expect(harness.client.session.prompt).toHaveBeenCalledTimes(2);
      expect(harness.client.session.prompt).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          path: { id: "session-worldview-2" },
          body: expect.objectContaining({
            parts: [
              {
                type: "text",
                text: `<system-reminder>\nInstructions from: ${parentPath}\nParent worldview guidance\n\nInstructions from: ${childPath}\nChild worldview guidance\n</system-reminder>`,
                synthetic: true,
              },
            ],
          }),
        }),
      );
      expect(harness.client.session.prompt).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          path: { id: "session-worldview-2" },
          body: expect.objectContaining({
            parts: [
              {
                type: "text",
                text: `<system-reminder>\nInstructions from: ${deepPath}\nDeep worldview guidance\n</system-reminder>`,
                synthetic: true,
              },
            ],
          }),
        }),
      );
      expect(harness.client.session.messages).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("bounds worldview reminder text so it stays within the shared prompt budget", async () => {
    const harness = await createWorldviewPluginHarness();

    try {
      const longContent = "Worldview ".repeat(800);

      for (const relativePath of [
        "apps/AGENTS.md",
        "apps/one/AGENTS.md",
        "apps/one/two/AGENTS.md",
        "apps/one/two/three/AGENTS.md",
        "apps/one/two/three/four/AGENTS.md",
      ]) {
        await writeText(path.join(harness.rootDir, relativePath), longContent);
      }

      await invokeRead(harness, "session-worldview-3", "apps/one/two/three/four/src/index.ts");

      const injectedPrompt = harness.client.session.prompt.mock.calls[0]?.[0] as
        | {
            body?: {
              parts?: Array<{ type?: string; text?: string }>;
            };
          }
        | undefined;
      const text = injectedPrompt?.body?.parts?.[0]?.text;

      expect(text).toEqual(expect.any(String));
      expect(Buffer.byteLength(text ?? "", "utf8")).toBeLessThanOrEqual(
        FRAMEWORK_WORLDVIEW_INJECTION_MAX_BYTES,
      );
      expect(text?.match(/Instructions from:/g)?.length ?? 0).toBeLessThanOrEqual(
        FRAMEWORK_WORLDVIEW_INJECTION_MAX_ITEMS,
      );
      expect(text).toContain("...");
    } finally {
      await harness.cleanup();
    }
  });
});

async function createWorldviewPluginHarness(
  options: {
    sessionMessages?: NonNullable<
      Parameters<typeof createFrameworkMockClient>[0]
    >["sessionMessages"];
  } = {},
) {
  const { EpistemologyFrameworkPlugin } = await import("../index.ts");
  const globalConfig = path.join(
    os.tmpdir(),
    `epistemology-framework-global-${Date.now()}-${Math.random().toString(16).slice(2)}.toml`,
  );

  return createFrameworkHookHarness({
    clientOptions: {
      sessionMessages: options.sessionMessages,
    },
    createHooks: async (context) => {
      const previousGlobalConfig = process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG;
      process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG = globalConfig;

      try {
        return await EpistemologyFrameworkPlugin(context);
      } finally {
        if (previousGlobalConfig === undefined) {
          delete process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG;
        } else {
          process.env.OPENCODE_POLICY_GUARDRAIL_GLOBAL_CONFIG = previousGlobalConfig;
        }
      }
    },
  });
}

async function invokeRead(
  harness: Awaited<ReturnType<typeof createWorldviewPluginHarness>>,
  sessionID: string,
  filePath: string,
): Promise<void> {
  await harness.invokeToolBefore(
    {
      tool: "read",
      callID: `${sessionID}-${filePath}-before`,
      sessionID,
    },
    { filePath },
  );
  await harness.invokeToolAfter({
    tool: "read",
    callID: `${sessionID}-${filePath}-before`,
    sessionID,
  });
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}
