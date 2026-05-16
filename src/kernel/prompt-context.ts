import type { FrameworkJsonObject, FrameworkModelRef, FrameworkPromptContext } from "./state.ts";

export interface FrameworkSessionPromptContext {
  messageID?: string;
  agent?: string;
  model?: FrameworkPromptContext["model"];
  system?: string;
  variant?: string;
  tools?: Record<string, boolean>;
}

export interface FrameworkPromptContextMessageInfo {
  messageID?: unknown;
  role?: unknown;
  agent?: unknown;
  model?: unknown;
  system?: unknown;
  variant?: unknown;
  tools?: unknown;
}

export interface FrameworkPromptContextMessage {
  info?: FrameworkPromptContextMessageInfo | null;
}

export interface FrameworkPromptContextMessagesResult {
  data?: FrameworkPromptContextMessage[] | null;
}

export interface FrameworkPromptContextClient {
  session: {
    messages?: (args: {
      path: { id: string };
      query?: { limit?: number };
    }) => Promise<FrameworkPromptContextMessagesResult>;
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isModelRef(value: unknown): value is FrameworkModelRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const maybeModel = value as { providerID?: unknown; modelID?: unknown };
  return isString(maybeModel.providerID) && isString(maybeModel.modelID);
}

function isJsonObject(value: unknown): value is FrameworkJsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneModelRef(model: unknown): FrameworkModelRef | undefined {
  return isModelRef(model) ? structuredClone(model) : undefined;
}

function cloneTools(tools: unknown): FrameworkJsonObject | undefined {
  return isJsonObject(tools) ? structuredClone(tools) : undefined;
}

function toPromptContext(info: FrameworkPromptContextMessageInfo): FrameworkPromptContext {
  return {
    messageID: isString(info.messageID) ? info.messageID : undefined,
    role: isString(info.role) ? info.role : undefined,
    agent: isString(info.agent) ? info.agent : undefined,
    model: cloneModelRef(info.model),
    system: isString(info.system) ? info.system : undefined,
    variant: isString(info.variant) ? info.variant : undefined,
    tools: cloneTools(info.tools),
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

export function toSessionPromptContext(
  promptContext: FrameworkPromptContext,
): FrameworkSessionPromptContext {
  return {
    messageID: promptContext.messageID,
    agent: promptContext.agent,
    model: promptContext.model,
    system: promptContext.system,
    variant: promptContext.variant,
    tools: normalizePromptTools(promptContext.tools),
  };
}

export async function resolveSessionPromptContext(
  client: FrameworkPromptContextClient,
  sessionID: string,
  options: { limit?: number } = {},
): Promise<FrameworkPromptContext | null> {
  if (typeof client.session.messages !== "function") {
    return null;
  }

  const messages = await client.session.messages({
    path: { id: sessionID },
    query: { limit: options.limit ?? 10 },
  });

  for (const message of messages.data ?? []) {
    if (message.info?.role !== "user") continue;

    const promptContext = toPromptContext(message.info);
    if (!promptContext.agent || !promptContext.model) {
      return null;
    }

    return promptContext;
  }

  return null;
}
