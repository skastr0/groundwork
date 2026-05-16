import type { GuardrailAction, GuardrailSkillEnforcementMode } from "./config-types.ts";
import { normalizeStringList } from "./config-parser-fields.ts";

const SKILL_ENFORCEMENT_MODE = new Set<GuardrailSkillEnforcementMode>(["prompt", "block"]);

export function parseAction(ruleId: string, value: unknown, index: number): GuardrailAction {
  if (!value || typeof value !== "object") {
    throw new Error(`Action ${index} in rule '${ruleId}' must be an object`);
  }

  const raw = value as {
    type?: unknown;
    text?: unknown;
    once_per_session?: unknown;
    message?: unknown;
    skills?: unknown;
    mode?: unknown;
  };

  if (raw.type === "inject_prompt") {
    if (typeof raw.text !== "string" || raw.text.trim().length === 0) {
      throw new Error(`inject_prompt action in rule '${ruleId}' requires non-empty text`);
    }

    return {
      type: "inject_prompt",
      text: raw.text,
      once_per_session: raw.once_per_session === true,
    };
  }

  if (raw.type === "block_tool") {
    return {
      type: "block_tool",
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  }

  if (raw.type === "require_human_override") {
    return {
      type: "require_human_override",
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  }

  if (raw.type === "stop_session") {
    return {
      type: "stop_session",
      message: typeof raw.message === "string" ? raw.message : undefined,
    };
  }

  if (raw.type === "ensure_skill_loaded") {
    const skills = normalizeStringList(raw.skills);
    if (skills.length === 0) {
      throw new Error(`ensure_skill_loaded action in rule '${ruleId}' requires non-empty skills`);
    }

    const mode = parseSkillEnforcementMode(ruleId, index, raw.mode);
    return {
      type: "ensure_skill_loaded",
      skills,
      mode,
      message: typeof raw.message === "string" ? raw.message : undefined,
      once_per_session: raw.once_per_session === true,
    };
  }

  throw new Error(`Unsupported action type in rule '${ruleId}' at index ${index}`);
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
