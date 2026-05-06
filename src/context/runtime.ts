import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { GroundworkLayerRegistration } from "../layer/index.ts";
import {
  applyFrameworkPromptBudget,
  createFrameworkActionDedupeKey,
  createSessionKernelStore,
  extractFrameworkToolTargets,
  FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS,
  getFrameworkCacheEntry,
  rememberFrameworkAction,
  resolveSessionPromptContext,
  truncateFrameworkTextByBytes,
  type FrameworkPromptContext,
  type FrameworkPromptContextClient,
  type FrameworkSessionKernelState,
  type FrameworkToolTarget,
  type SessionKernelStore,
} from "../kernel/index.ts";
import {
  discoverFrameworkContextFiles,
  type FrameworkDiscoveredContextFile,
} from "./discovery.ts";

const SERVICE = "groundwork-context";
const CONTEXT_TRIGGER_TOOLS = new Set(["read", "edit", "write", "patch", "apply_patch"]);
const CONTEXT_PROMPT_CONTEXT_LIMIT = 10;
const CONTEXT_REMINDER_PREFIX = "<system-reminder>\n";
const CONTEXT_REMINDER_SUFFIX = "\n</system-reminder>";
const CONTEXT_REMINDER_SEPARATOR = "\n\n";
const CONTEXT_DEDUPE_SOURCE = "context";
const CONTEXT_DEDUPE_ACTION = "inject-file";

export const FRAMEWORK_CONTEXT_INJECTION_MAX_ITEMS = 4;
export const FRAMEWORK_CONTEXT_INJECTION_MAX_BYTES = 3072;

const CONTEXT_REMINDER_CONTENT_MAX_BYTES = Math.max(
  0,
  FRAMEWORK_CONTEXT_INJECTION_MAX_BYTES -
    Buffer.byteLength(CONTEXT_REMINDER_PREFIX, "utf8") -
    Buffer.byteLength(CONTEXT_REMINDER_SUFFIX, "utf8") -
    Buffer.byteLength(CONTEXT_REMINDER_SEPARATOR, "utf8") *
      Math.max(0, FRAMEWORK_CONTEXT_INJECTION_MAX_ITEMS - 1),
);

type FrameworkContextRuntimeClient = PluginInput["client"] & FrameworkPromptContextClient;

type BoundedContextReminder = {
  file: FrameworkDiscoveredContextFile;
  text: string;
};

export interface CreateFrameworkContextLayerOptions {
  client: FrameworkContextRuntimeClient;
  directory: string;
  sessionStore?: SessionKernelStore;
  worktree?: string;
}

type ContextLayerRuntime = {
  client: FrameworkContextRuntimeClient;
  directory: string;
  rootDir: string;
  sessionStore: SessionKernelStore;
};

export async function createFrameworkContextLayer(
  options: CreateFrameworkContextLayerOptions,
): Promise<GroundworkLayerRegistration> {
  const directory = path.resolve(options.directory);
  const rootDir = path.resolve(options.worktree ?? options.directory);
  const sessionStore = options.sessionStore ?? createSessionKernelStore();

  await log(options.client, "info", "Framework context runtime initialized", {
    directory,
    rootDir,
    max_items: FRAMEWORK_CONTEXT_INJECTION_MAX_ITEMS,
    max_bytes: FRAMEWORK_CONTEXT_INJECTION_MAX_BYTES,
  });

  return {
    active: true,
    hooks: createContextLayerHooks({
      client: options.client,
      directory,
      rootDir,
      sessionStore,
    }),
  };
}

function createContextLayerHooks(runtime: ContextLayerRuntime): GroundworkLayerRegistration["hooks"] {
  return {
    "tool.execute.before": async ({ tool, callID, sessionID }, { args }) => {
      handleContextToolBefore(runtime, tool, callID, sessionID, args);
    },

    "tool.execute.after": async ({ tool, callID, sessionID }) => {
      await handleContextToolAfter(runtime, tool, callID, sessionID);
    },

    event: async ({ event }) => {
      handleContextEvent(runtime, event);
    },
  };
}

function handleContextToolBefore(
  runtime: ContextLayerRuntime,
  tool: string,
  callID: string,
  sessionID: string,
  args: unknown,
): void {
  if (!CONTEXT_TRIGGER_TOOLS.has(tool)) {
    return;
  }

  const extraction = extractFrameworkToolTargets(asToolArgs(args), {
    toolName: tool,
    directory: runtime.directory,
    rootDir: runtime.rootDir,
  });
  if (extraction.targets.length === 0) {
    return;
  }

  const state = getOrCreateSessionState(runtime.sessionStore, sessionID);
  state.pendingTools.calls[createContextPendingToolKey(callID)] = {
    callID,
    toolName: tool,
    phase: "after",
    capturedAt: new Date().toISOString(),
    targets: structuredClone(extraction.targets),
    data: {
      source: SERVICE,
    },
  };
  runtime.sessionStore.set(state);
}

async function handleContextToolAfter(
  runtime: ContextLayerRuntime,
  tool: string,
  callID: string,
  sessionID: string,
): Promise<void> {
  if (!CONTEXT_TRIGGER_TOOLS.has(tool)) {
    return;
  }

  let state = getOrCreateSessionState(runtime.sessionStore, sessionID);
  const pendingKey = createContextPendingToolKey(callID);
  const pending = state.pendingTools.calls[pendingKey];
  if (!pending) {
    return;
  }

  delete state.pendingTools.calls[pendingKey];
  state = runtime.sessionStore.set(state);

  const discoveredFiles = await collectDiscoveredContextFiles(pending.targets, {
    directory: runtime.directory,
    rootDir: runtime.rootDir,
  });
  const unseenFiles = discoveredFiles.filter((file) => !hasInjectedContextFile(state, file.path));
  if (unseenFiles.length === 0) {
    return;
  }

  await injectContextReminders({
    runtime,
    state,
    sessionID,
    callID,
    tool,
    targetCount: pending.targets.length,
    discoveredFiles,
    unseenFiles,
  });
}

async function injectContextReminders(options: {
  runtime: ContextLayerRuntime;
  state: FrameworkSessionKernelState;
  sessionID: string;
  callID: string;
  tool: string;
  targetCount: number;
  discoveredFiles: FrameworkDiscoveredContextFile[];
  unseenFiles: FrameworkDiscoveredContextFile[];
}): Promise<void> {
  const { runtime, sessionID, callID, tool, discoveredFiles, unseenFiles } = options;
  let { state } = options;
  const promptContext = await resolveContextPromptContext(runtime.client, state, sessionID);
  if (!promptContext) {
    await log(runtime.client, "warn", "Skipping context injection because prompt context is unavailable", {
      sessionID,
      callID,
      tool,
      target_count: options.targetCount,
      context_paths: unseenFiles.map((file) => file.path),
    });
    return;
  }

  state.promptContext ??= promptContext;
  state = runtime.sessionStore.set(state);

  const now = new Date().toISOString();
  const reminders = buildBoundedContextReminders(state, unseenFiles, now);
  if (reminders.length === 0) {
    return;
  }

  const text = wrapContextReminder(reminders.map((reminder) => reminder.text));
  if (!text) {
    return;
  }

  await runtime.client.session.prompt({
    path: { id: sessionID },
    body: {
      ...toSessionPromptContext(promptContext),
      noReply: true,
      parts: [
        {
          type: "text",
          text,
          synthetic: true,
        },
      ],
    },
  });

  for (const reminder of reminders) {
    rememberFrameworkAction(state, {
      now,
      source: CONTEXT_DEDUPE_SOURCE,
      action: CONTEXT_DEDUPE_ACTION,
      parts: [reminder.file.path],
      metadata: {
        path: reminder.file.path,
        fileName: reminder.file.fileName,
      },
    });
  }
  runtime.sessionStore.set(state);

  await log(runtime.client, "info", "Injected context reminders", {
    sessionID,
    callID,
    tool,
    injected_count: reminders.length,
    discovered_count: discoveredFiles.length,
    context_paths: reminders.map((reminder) => reminder.file.path),
    bounded_bytes: Buffer.byteLength(text, "utf8"),
  });
}

function handleContextEvent(
  runtime: ContextLayerRuntime,
  event: { type: string; properties?: unknown },
): void {
  if (event.type !== "session.deleted") {
    return;
  }

  const sessionID = readEventSessionID(event.properties);
  if (!sessionID) {
    return;
  }

  runtime.sessionStore.cleanup(sessionID);
}

function asToolArgs(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getOrCreateSessionState(
  sessionStore: ReturnType<typeof createSessionKernelStore>,
  sessionID: string,
): FrameworkSessionKernelState {
  return sessionStore.get(sessionID) ?? sessionStore.create(sessionID);
}

function createContextPendingToolKey(callID: string): string {
  return `${SERVICE}::${callID}`;
}

async function collectDiscoveredContextFiles(
  targets: readonly FrameworkToolTarget[],
  options: { directory: string; rootDir: string },
): Promise<FrameworkDiscoveredContextFile[]> {
  const files: FrameworkDiscoveredContextFile[] = [];
  const seenPaths = new Set<string>();

  for (const target of targets) {
    const targetPath = resolveDiscoveryTargetPath(target, options.rootDir);
    if (!targetPath) {
      continue;
    }

    const discovered = await discoverFrameworkContextFiles({
      targetPath,
      directory: options.directory,
      rootDir: options.rootDir,
    });

    for (const file of discovered) {
      if (seenPaths.has(file.path)) {
        continue;
      }

      seenPaths.add(file.path);
      files.push(file);
    }
  }

  return files;
}

function resolveDiscoveryTargetPath(target: FrameworkToolTarget, rootDir: string): string | null {
  const normalizedPath = target.afterPath ?? target.beforePath ?? target.normalizedPath;
  if (!normalizedPath || normalizedPath === ".") {
    return null;
  }

  return path.join(rootDir, normalizedPath);
}

async function resolveContextPromptContext(
  client: FrameworkContextRuntimeClient,
  state: FrameworkSessionKernelState,
  sessionID: string,
): Promise<FrameworkPromptContext | null> {
  if (state.promptContext) {
    return state.promptContext;
  }

  const promptContext = await resolveSessionPromptContext(client, sessionID, {
    limit: CONTEXT_PROMPT_CONTEXT_LIMIT,
  });
  if (promptContext) {
    state.promptContext = promptContext;
  }

  return promptContext;
}

function hasInjectedContextFile(
  state: FrameworkSessionKernelState,
  contextPath: string,
): boolean {
  const key = createFrameworkActionDedupeKey({
    source: CONTEXT_DEDUPE_SOURCE,
    action: CONTEXT_DEDUPE_ACTION,
    parts: [contextPath],
  });

  return (
    getFrameworkCacheEntry(state, FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS.frameworkActions, key) !==
    null
  );
}

function buildBoundedContextReminders(
  state: FrameworkSessionKernelState,
  files: readonly FrameworkDiscoveredContextFile[],
  now: string,
): BoundedContextReminder[] {
  const reminders = files.map((file) => ({
    file,
    text: createContextReminderText(file),
  }));

  return applyFrameworkPromptBudget(state, reminders, {
    now,
    itemLimit: FRAMEWORK_CONTEXT_INJECTION_MAX_ITEMS,
    byteLimit: CONTEXT_REMINDER_CONTENT_MAX_BYTES,
    getSize: (reminder) => Buffer.byteLength(reminder.text, "utf8"),
    truncateItem: (reminder, maxBytes) => {
      const text = truncateContextReminderText(reminder.file, maxBytes);
      return text ? { ...reminder, text } : null;
    },
    metadata: {
      purpose: "context",
      source: SERVICE,
    },
  }).items;
}

function createContextReminderText(file: FrameworkDiscoveredContextFile): string {
  return `Instructions from: ${file.path}\n${file.content}`;
}

function truncateContextReminderText(
  file: FrameworkDiscoveredContextFile,
  maxBytes: number,
): string {
  const limit = Math.max(0, Math.floor(maxBytes));
  if (limit === 0) {
    return "";
  }

  const header = `Instructions from: ${file.path}\n`;
  const headerBytes = Buffer.byteLength(header, "utf8");
  if (headerBytes >= limit) {
    return truncateFrameworkTextByBytes(header.trimEnd(), limit);
  }

  const truncatedContent = truncateFrameworkTextByBytes(file.content, limit - headerBytes);
  return truncatedContent ? `${header}${truncatedContent}` : header.trimEnd();
}

function wrapContextReminder(reminders: readonly string[]): string {
  const body = reminders.join(CONTEXT_REMINDER_SEPARATOR).trim();
  if (!body) {
    return "";
  }

  return `${CONTEXT_REMINDER_PREFIX}${body}${CONTEXT_REMINDER_SUFFIX}`;
}

function toSessionPromptContext(promptContext: FrameworkPromptContext): {
  messageID?: string;
  agent?: string;
  model?: FrameworkPromptContext["model"];
  system?: string;
  variant?: string;
  tools?: Record<string, boolean>;
} {
  return {
    messageID: promptContext.messageID,
    agent: promptContext.agent,
    model: promptContext.model,
    system: promptContext.system,
    variant: promptContext.variant,
    tools: normalizePromptTools(promptContext.tools),
  };
}

function normalizePromptTools(
  tools: FrameworkPromptContext["tools"],
): Record<string, boolean> | undefined {
  if (!tools) {
    return undefined;
  }

  const result: Record<string, boolean> = {};
  for (const [toolName, enabled] of Object.entries(tools)) {
    if (typeof enabled === "boolean") {
      result[toolName] = enabled;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function readEventSessionID(properties: unknown): string | null {
  if (!isRecord(properties)) {
    return null;
  }

  if (typeof properties.id === "string" && properties.id.length > 0) {
    return properties.id;
  }

  if (typeof properties.sessionID === "string" && properties.sessionID.length > 0) {
    return properties.sessionID;
  }

  return null;
}

async function log(
  client: FrameworkContextRuntimeClient,
  level: "debug" | "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    await client.app.log({
      body: {
        service: SERVICE,
        level,
        message,
        extra,
      },
    });
  } catch {
    // ignore logging failures
  }
}
