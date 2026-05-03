import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Event } from "@opencode-ai/sdk";
import { vi } from "vitest";

type MaybePromise<T> = T | Promise<T>;

export type FrameworkSessionMessagesResult = {
  data: Array<{
    info: {
      role: string;
      agent: string;
      model: {
        providerID: string;
        modelID: string;
      };
      system: string;
      tools: Record<string, unknown>;
      variant: string;
    };
  }>;
};

export type FrameworkMockClientOptions = {
  sessionMessages?:
    | FrameworkSessionMessagesResult
    | (() => MaybePromise<FrameworkSessionMessagesResult>);
};

export type FrameworkMockClient = {
  app: {
    log: ReturnType<typeof vi.fn>;
  };
  session: {
    messages: ReturnType<typeof vi.fn>;
    prompt: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
};

export type FrameworkHookHarnessOptions = {
  plugin?: Plugin;
  createHooks?: (context: PluginInput) => MaybePromise<Hooks>;
  hooks?: Hooks;
  client?: FrameworkMockClient;
  clientOptions?: FrameworkMockClientOptions;
  directory?: string;
  worktree?: string;
  serverUrl?: string | URL;
  shell?: PluginInput["$"];
  project?: PluginInput["project"];
  tempDirPrefix?: string;
};

export function createDefaultFrameworkSessionMessages(): FrameworkSessionMessagesResult {
  return {
    data: [
      {
        info: {
          role: "user",
          agent: "builder",
          model: { providerID: "openai", modelID: "gpt-5.4" },
          system: "preserve system prompt",
          tools: { edit: true, read: true },
          variant: "careful",
        },
      },
    ],
  };
}

export function createFrameworkMockClient(
  options: FrameworkMockClientOptions = {},
): FrameworkMockClient {
  const readSessionMessages = async () => {
    if (typeof options.sessionMessages === "function") {
      return options.sessionMessages();
    }

    return options.sessionMessages ?? createDefaultFrameworkSessionMessages();
  };

  return {
    app: {
      log: vi.fn(async () => {}),
    },
    session: {
      messages: vi.fn(async () => readSessionMessages()),
      prompt: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    },
  };
}

export async function createFrameworkHookHarness(
  options: FrameworkHookHarnessOptions = {},
): Promise<{
  rootDir: string;
  worktree: string;
  client: FrameworkMockClient;
  context: PluginInput;
  hooks: Hooks;
  addCleanup: (cleanup: () => MaybePromise<void>) => void;
  invokeHook: (hookName: keyof Hooks, ...args: unknown[]) => Promise<unknown>;
  invokeToolBefore: (
    input: { tool: string; callID: string; sessionID: string },
    args?: unknown,
  ) => Promise<unknown>;
  invokeToolAfter: (
    input: { tool: string; callID: string; sessionID: string },
    output?: { title: string; output: string; metadata: unknown },
  ) => Promise<unknown>;
  invokeChatMessage: (
    input: {
      sessionID: string;
      agent?: string;
      model?: { providerID: string; modelID: string };
      messageID?: string;
      variant?: string;
    },
    output: { message?: unknown; parts: unknown[] },
  ) => Promise<unknown>;
  emitEvent: (event: Event) => Promise<unknown>;
  cleanupSession: (sessionID: string, eventType?: Event["type"]) => Promise<void>;
  cleanup: () => Promise<void>;
}> {
  const createdTempDir = options.directory === undefined;
  const rootDir =
    options.directory ??
    (await fs.mkdtemp(
      path.join(os.tmpdir(), options.tempDirPrefix ?? "groundwork-test-"),
    ));
  const worktree = options.worktree ?? rootDir;
  const client = options.client ?? createFrameworkMockClient(options.clientOptions);
  const context = {
    client: client as unknown as PluginInput["client"],
    project: (options.project ?? {}) as PluginInput["project"],
    directory: rootDir,
    worktree,
    serverUrl:
      options.serverUrl instanceof URL
        ? options.serverUrl
        : new URL(options.serverUrl ?? "https://opencode.test"),
    $: (options.shell ?? {}) as PluginInput["$"],
  } satisfies PluginInput;

  const hooks = options.plugin
    ? await options.plugin(context)
    : options.createHooks
      ? await options.createHooks(context)
      : (options.hooks ?? {});
  const cleanupCallbacks: Array<() => MaybePromise<void>> = [];

  const invokeHook = async (hookName: keyof Hooks, ...args: unknown[]) => {
    const hook = hooks[hookName];
    if (typeof hook !== "function") {
      throw new Error(`Framework hook '${String(hookName)}' is not defined`);
    }

    return (hook as (...hookArgs: unknown[]) => Promise<unknown>)(...args);
  };

  return {
    rootDir,
    worktree,
    client,
    context,
    hooks,
    addCleanup: (cleanup) => {
      cleanupCallbacks.push(cleanup);
    },
    invokeHook,
    invokeToolBefore: (input, args = {}) => invokeHook("tool.execute.before", input, { args }),
    invokeToolAfter: (input, output) =>
      invokeHook(
        "tool.execute.after",
        input,
        output ?? { title: input.tool, output: "", metadata: {} },
      ),
    invokeChatMessage: (input, output) => invokeHook("chat.message", input, output),
    emitEvent: (event) => invokeHook("event", { event }),
    cleanupSession: async (sessionID, eventType = "session.deleted") => {
      if (typeof hooks.event !== "function") {
        return;
      }

      await hooks.event({
        event: {
          type: eventType,
          properties: { sessionID },
        } as Event,
      });
    },
    cleanup: async () => {
      for (const cleanup of cleanupCallbacks.reverse()) {
        await cleanup();
      }

      if (createdTempDir) {
        await fs.rm(rootDir, { recursive: true, force: true });
      }
    },
  };
}
