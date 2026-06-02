import path from "node:path";

export function normalizeSlashes(value: string): string {
  return value.split(path.sep).join("/");
}

export function globMatch(pattern: string, target: string): boolean {
  const source = `^${globToRegexSource(pattern)}$`;
  return new RegExp(source).test(target);
}

export function toolMatchesPatterns(patterns: string[], tool: string): boolean {
  if (patterns.length === 0) return false;
  return patterns.some((pattern) => pattern === "*" || globMatch(pattern, tool));
}

function globToRegexSource(pattern: string): string {
  const normalized = pattern.split(path.sep).join("/");
  let output = "";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i] ?? "";
    const next = normalized[i + 1] ?? "";
    const nextTwo = normalized[i + 2] ?? "";

    if (char === "*" && next === "*" && nextTwo === "/") {
      output += "(?:.*/)?";
      i += 2;
      continue;
    }

    if (char === "*" && next === "*") {
      output += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      output += "[^/]*";
      continue;
    }

    if (char === "?") {
      output += "[^/]";
      continue;
    }

    output += escapeRegex(char);
  }

  return output;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}
