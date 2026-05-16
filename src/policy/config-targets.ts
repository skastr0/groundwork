import { isPatchTextKey, mergeChangeTarget } from "./change-targets.ts";
import { extractPathsFromPatchText, extractTargetsFromPatchText } from "./patch-targets.ts";
import { normalizePathForMatching } from "./paths.ts";
import type { GuardrailChangeTarget } from "./config-types.ts";

export function extractCandidatePaths(args: unknown): string[] {
  const results = new Set<string>();
  collectPaths(args, results, []);
  return Array.from(results);
}

export function extractChangeTargets(rootDir: string, args: unknown): GuardrailChangeTarget[] {
  const results = new Map<string, GuardrailChangeTarget>();
  collectChangeTargets(rootDir, args, results, []);
  return Array.from(results.values());
}

function collectPaths(value: unknown, out: Set<string>, keyPath: string[]): void {
  if (typeof value === "string") {
    const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? "";
    if (isPatchTextKey(key)) {
      for (const patchPath of extractPathsFromPatchText(value)) {
        out.add(patchPath);
      }
      return;
    }

    if (looksLikePath(value, key)) {
      out.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectPaths(entry, out, keyPath);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    collectPaths(entry, out, [...keyPath, key]);
  }
}

function collectChangeTargets(
  rootDir: string,
  value: unknown,
  out: Map<string, GuardrailChangeTarget>,
  keyPath: string[],
): void {
  if (typeof value === "string") {
    const key = keyPath[keyPath.length - 1]?.toLowerCase() ?? "";
    if (isPatchTextKey(key)) {
      for (const target of extractTargetsFromPatchText(rootDir, value)) {
        mergeChangeTarget(out, target);
      }
      return;
    }

    if (looksLikePath(value, key)) {
      mergeChangeTarget(out, {
        normalizedPath: normalizePathForMatching(rootDir, value),
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectChangeTargets(rootDir, entry, out, keyPath);
    }
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value)) {
    collectChangeTargets(rootDir, entry, out, [...keyPath, key]);
  }
}

function looksLikePath(value: string, keyName: string): boolean {
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  if (/[\r\n]/.test(normalized)) return false;

  const pathKeys = ["filepath", "path", "paths", "dir", "directory", "cwd", "workdir"];
  if (pathKeys.includes(keyName)) return true;

  if (normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../")) {
    return true;
  }

  return /[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+/.test(normalized);
}
