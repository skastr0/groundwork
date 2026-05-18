import type { GuardrailAction, GuardrailSkillEnforcementMode } from "./config-types.ts";
import { normalizeStringList } from "./config-parser-fields.ts";

const SKILL_ENFORCEMENT_MODE = new Set<GuardrailSkillEnforcementMode>(["prompt", "block"]);

type RawAction = {
  type?: unknown;
  text?: unknown;
  once_per_session?: unknown;
  message?: unknown;
  skills?: unknown;
  mode?: unknown;
};

type MessageActionType = "block_tool" | "require_human_override" | "stop_session";
type ActionType = GuardrailAction["type"];

const ACTION_TYPES = new Set<ActionType>([
  "inject_prompt", "block_tool", "require_human_override",
  "stop_session", "ensure_skill_loaded",
]);

export function parseAction(ruleId: string, value: unknown, index: number): GuardrailAction {
  const raw = readRawAction(ruleId, value, index);
  const actionType = readActionType(ruleId, index, raw);

  switch (actionType) {
    case "inject_prompt":
      return parseInjectPromptAction(ruleId, raw);
    case "block_tool":
    case "require_human_override":
    case "stop_session":
      return parseMessageAction(actionType, raw);
    case "ensure_skill_loaded":
      return parseEnsureSkillLoadedAction(ruleId, index, raw);
  }

  return assertNever(actionType);
}

function readRawAction(ruleId: string, value: unknown, index: number): RawAction {
  if (!value || typeof value !== "object") {
    throw new Error(`Action ${index} in rule '${ruleId}' must be an object`);
  }

  return value as RawAction;
}

function readActionType(ruleId: string, index: number, raw: RawAction): ActionType {
  if (typeof raw.type === "string" && ACTION_TYPES.has(raw.type as ActionType)) {
    return raw.type as ActionType;
  }

  throw new Error(`Unsupported action type in rule '${ruleId}' at index ${index}`);
}

function assertNever(value: never): never {
  throw new Error(`Unsupported action type: ${String(value)}`);
}

function parseInjectPromptAction(ruleId: string, raw: RawAction): GuardrailAction {
  if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
    throw new Error(`inject_prompt action in rule '${ruleId}' requires non-empty text`);
  }

  return {
    type: "inject_prompt",
    text: raw.text,
    once_per_session: raw.once_per_session === true,
  };
}

function parseMessageAction(type: MessageActionType, raw: RawAction): GuardrailAction {
  const message = getOptionalMessage(raw);

  if (type === "block_tool") {
    return { type: "block_tool", message };
  }

  if (type === "require_human_override") {
    return { type: "require_human_override", message };
  }

  return { type: "stop_session", message };
}

function parseEnsureSkillLoadedAction(
  ruleId: string,
  index: number,
  raw: RawAction,
): GuardrailAction {
  const skills = normalizeStringList(raw.skills);
  if (skills.length === 0) {
    throw new Error(`ensure_skill_loaded action in rule '${ruleId}' requires non-empty skills`);
  }

  return {
    type: "ensure_skill_loaded",
    skills,
    mode: parseSkillEnforcementMode(ruleId, index, raw.mode),
    message: getOptionalMessage(raw),
    once_per_session: raw.once_per_session === true,
  };
}

function getOptionalMessage(raw: RawAction): string | undefined {
  return typeof raw.message === "string" ? raw.message : undefined;
}

function parseSkillEnforcementMode(
  ruleId: string,
  index: number,
  value: unknown,
): GuardrailSkillEnforcementMode | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Action ${index} in rule '${ruleId}' has invalid mode`);
  }

  const normalized = value.trim().toLowerCase() as GuardrailSkillEnforcementMode;
  if (!SKILL_ENFORCEMENT_MODE.has(normalized)) {
    throw new Error(`Action ${index} in rule '${ruleId}' has unsupported mode '${value}'`);
  }

  return normalized;
}
