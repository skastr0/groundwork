import type { ParsedPolicyCommand } from "./runtime-types.ts";

export function parsePolicyCommands(parts: unknown): ParsedPolicyCommand[] {
  if (!Array.isArray(parts)) return [];

  const text = parts
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const maybePart = part as { type?: unknown; text?: unknown };
      if (maybePart.type !== "text") return "";
      return typeof maybePart.text === "string" ? maybePart.text : "";
    })
    .filter((entry) => entry.length > 0)
    .join("\n");

  if (text.length === 0) return [];

  const commands: ParsedPolicyCommand[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("/policy ")) continue;

    if (trimmed.startsWith("/policy override ")) {
      const reason = trimmed.slice("/policy override ".length).trim();
      if (reason.length > 0) {
        commands.push({ type: "override", reason });
      }
      continue;
    }

    if (trimmed.startsWith("/policy skill-loaded ")) {
      const skills = trimmed
        .slice("/policy skill-loaded ".length)
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
      if (skills.length > 0) {
        commands.push({ type: "skill_loaded", skills });
      }
    }
  }

  return commands;
}

export function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase();
}
