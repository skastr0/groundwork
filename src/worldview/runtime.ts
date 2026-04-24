import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { EpistemologyFrameworkLayerRegistration } from "../layer/index.ts";
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
  discoverFrameworkWorldviewFiles,
  type FrameworkDiscoveredWorldviewFile,
} from "./discovery.ts";

const SERVICE = "epistemology-framework-worldview";
const WORLDVIEW_TRIGGER_TOOLS = new Set(["read", "edit", "write", "patch", "apply_patch"]);
const WORLDVIEW_PROMPT_CONTEXT_LIMIT = 10;
const WORLDVIEW_REMINDER_PREFIX = "<system-reminder>\n";
const WORLDVIEW_REMINDER_SUFFIX = "\n</system-reminder>";
const WORLDVIEW_REMINDER_SEPARATOR = "\n\n";
const WORLDVIEW_DEDUPE_SOURCE = "worldview";
const WORLDVIEW_DEDUPE_ACTION = "inject-file";

export const FRAMEWORK_WORLDVIEW_INJECTION_MAX_ITEMS = 4;
export const FRAMEWORK_WORLDVIEW_INJECTION_MAX_BYTES = 3072;

const WORLDVIEW_REMINDER_CONTENT_MAX_BYTES = Math.max(
  0,
  FRAMEWORK_WORLDVIEW_INJECTION_MAX_BYTES -
    Buffer.byteLength(WORLDVIEW_REMINDER_PREFIX, "utf8") -
    Buffer.byteLength(WORLDVIEW_REMINDER_SUFFIX, "utf8") -
    Buffer.byteLength(WORLDVIEW_REMINDER_SEPARATOR, "utf8") *
      Math.max(0, FRAMEWORK_WORLDVIEW_INJECTION_MAX_ITEMS - 1),
);

type FrameworkWorldviewRuntimeClient = PluginInput["client"] & FrameworkPromptContextClient;

type BoundedWorldviewReminder = {
  file: FrameworkDiscoveredWorldviewFile;
  text: string;
};

export interface CreateFrameworkWorldviewLayerOptions {
  client: FrameworkWorldviewRuntimeClient;
  directory: string;
  sessionStore?: SessionKernelStore;
  worktree?: string;
}

export async function createFrameworkWorldviewLayer(
  options: CreateFrameworkWorldviewLayerOptions,
): Promise<EpistemologyFrameworkLayerRegistration> {
  const directory = path.resolve(options.directory);
  const rootDir = path.resolve(options.worktree ?? options.directory);
  const sessionStore = options.sessionStore ?? createSessionKernelStore();

  await log(options.client, "info", "Framework worldview runtime initialized", {
    directory,
    rootDir,
    max_items: FRAMEWORK_WORLDVIEW_INJECTION_MAX_ITEMS,
    max_bytes: FRAMEWORK_WORLDVIEW_INJECTION_MAX_BYTES,
  });

  return {
    active: true,
    hooks: {
      "tool.execute.before": async ({ tool, callID, sessionID }, { args }) => {
        if (!WORLDVIEW_TRIGGER_TOOLS.has(tool)) {
          return;
        }

        const extraction = extractFrameworkToolTargets(asToolArgs(args), {
          toolName: tool,
          directory,
          rootDir,
        });
        if (extraction.targets.length === 0) {
          return;
        }

        const state = getOrCreateSessionState(sessionStore, sessionID);
        state.pendingTools.calls[createWorldviewPendingToolKey(callID)] = {
          callID,
          toolName: tool,
          phase: "after",
          capturedAt: new Date().toISOString(),
          targets: structuredClone(extraction.targets),
          data: {
            source: SERVICE,
          },
        };
        sessionStore.set(state);
      },

      "tool.execute.after": async ({ tool, callID, sessionID }) => {
        if (!WORLDVIEW_TRIGGER_TOOLS.has(tool)) {
          return;
        }

        let state = getOrCreateSessionState(sessionStore, sessionID);
        const pendingKey = createWorldviewPendingToolKey(callID);
        const pending = state.pendingTools.calls[pendingKey];
        if (!pending) {
          return;
        }

        delete state.pendingTools.calls[pendingKey];
        state = sessionStore.set(state);

        const discoveredFiles = await collectDiscoveredWorldviewFiles(pending.targets, {
          directory,
          rootDir,
        });
        const unseenFiles = discoveredFiles.filter(
          (file) => !hasInjectedWorldviewFile(state, file.path),
        );
        if (unseenFiles.length === 0) {
          return;
        }

        const promptContext = await resolveWorldviewPromptContext(options.client, state, sessionID);
        if (!promptContext) {
          await log(
            options.client,
            "warn",
            "Skipping worldview injection because prompt context is unavailable",
            {
              sessionID,
              callID,
              tool,
              target_count: pending.targets.length,
              worldview_paths: unseenFiles.map((file) => file.path),
            },
          );
          return;
        }

        state.promptContext ??= promptContext;
        state = sessionStore.set(state);

        const now = new Date().toISOString();
        const reminders = buildBoundedWorldviewReminders(state, unseenFiles, now);
        if (reminders.length === 0) {
          return;
        }

        const text = wrapWorldviewReminder(reminders.map((reminder) => reminder.text));
        if (!text) {
          return;
        }

        await options.client.session.prompt({
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
            source: WORLDVIEW_DEDUPE_SOURCE,
            action: WORLDVIEW_DEDUPE_ACTION,
            parts: [reminder.file.path],
            metadata: {
              path: reminder.file.path,
              fileName: reminder.file.fileName,
            },
          });
        }
        sessionStore.set(state);

        await log(options.client, "info", "Injected worldview reminders", {
          sessionID,
          callID,
          tool,
          injected_count: reminders.length,
          discovered_count: discoveredFiles.length,
          worldview_paths: reminders.map((reminder) => reminder.file.path),
          bounded_bytes: Buffer.byteLength(text, "utf8"),
        });
      },

      event: async ({ event }) => {
        if (event.type !== "session.deleted") {
          return;
        }

        const sessionID = readEventSessionID(event.properties);
        if (!sessionID) {
          return;
        }

        sessionStore.cleanup(sessionID);
      },
    },
  };
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

function createWorldviewPendingToolKey(callID: string): string {
  return `${SERVICE}::${callID}`;
}

async function collectDiscoveredWorldviewFiles(
  targets: readonly FrameworkToolTarget[],
  options: { directory: string; rootDir: string },
): Promise<FrameworkDiscoveredWorldviewFile[]> {
  const files: FrameworkDiscoveredWorldviewFile[] = [];
  const seenPaths = new Set<string>();

  for (const target of targets) {
    const targetPath = resolveDiscoveryTargetPath(target, options.rootDir);
    if (!targetPath) {
      continue;
    }

    const discovered = await discoverFrameworkWorldviewFiles({
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

async function resolveWorldviewPromptContext(
  client: FrameworkWorldviewRuntimeClient,
  state: FrameworkSessionKernelState,
  sessionID: string,
): Promise<FrameworkPromptContext | null> {
  if (state.promptContext) {
    return state.promptContext;
  }

  const promptContext = await resolveSessionPromptContext(client, sessionID, {
    limit: WORLDVIEW_PROMPT_CONTEXT_LIMIT,
  });
  if (promptContext) {
    state.promptContext = promptContext;
  }

  return promptContext;
}

function hasInjectedWorldviewFile(
  state: FrameworkSessionKernelState,
  worldviewPath: string,
): boolean {
  const key = createFrameworkActionDedupeKey({
    source: WORLDVIEW_DEDUPE_SOURCE,
    action: WORLDVIEW_DEDUPE_ACTION,
    parts: [worldviewPath],
  });

  return (
    getFrameworkCacheEntry(state, FRAMEWORK_KERNEL_DEDUPE_CACHE_BUCKETS.frameworkActions, key) !==
    null
  );
}

function buildBoundedWorldviewReminders(
  state: FrameworkSessionKernelState,
  files: readonly FrameworkDiscoveredWorldviewFile[],
  now: string,
): BoundedWorldviewReminder[] {
  const reminders = files.map((file) => ({
    file,
    text: createWorldviewReminderText(file),
  }));

  return applyFrameworkPromptBudget(state, reminders, {
    now,
    itemLimit: FRAMEWORK_WORLDVIEW_INJECTION_MAX_ITEMS,
    byteLimit: WORLDVIEW_REMINDER_CONTENT_MAX_BYTES,
    getSize: (reminder) => Buffer.byteLength(reminder.text, "utf8"),
    truncateItem: (reminder, maxBytes) => {
      const text = truncateWorldviewReminderText(reminder.file, maxBytes);
      return text ? { ...reminder, text } : null;
    },
    metadata: {
      purpose: "worldview",
      source: SERVICE,
    },
  }).items;
}

function createWorldviewReminderText(file: FrameworkDiscoveredWorldviewFile): string {
  return `Instructions from: ${file.path}\n${file.content}`;
}

function truncateWorldviewReminderText(
  file: FrameworkDiscoveredWorldviewFile,
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

function wrapWorldviewReminder(reminders: readonly string[]): string {
  const body = reminders.join(WORLDVIEW_REMINDER_SEPARATOR).trim();
  if (!body) {
    return "";
  }

  return `${WORLDVIEW_REMINDER_PREFIX}${body}${WORLDVIEW_REMINDER_SUFFIX}`;
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
  client: FrameworkWorldviewRuntimeClient,
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
