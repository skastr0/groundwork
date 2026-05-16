import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import type { GuardrailRule } from "./config.ts";
import { globMatch, normalizeSlashes } from "./glob.ts";

export const PROJECT_GROUNDWORK_CONFIG_FILE = "groundwork.toml";
export const PROJECT_GROUNDWORK_CONFIG_DIR = ".groundwork";
export const GLOBAL_GROUNDWORK_CONFIG_DIR = ".groundwork";
export type PolicyLoadContext = {
  rootDir: string;
  home?: string;
  scope: "global" | "project";
};
export async function resolveIncludedPolicyPaths(
  configPath: string,
  includes: string[],
): Promise<string[]> {
  const configDir = path.dirname(configPath);
  const resolved = new Set<string>();

  for (const include of includes) {
    const resolvedInclude = resolveIncludePath(configDir, include);
    const hasWildcard = includeHasWildcard(resolvedInclude);

    if (!hasWildcard) {
      resolved.add(path.resolve(resolvedInclude));
      continue;
    }

    const matched = await expandIncludePattern(resolvedInclude);
    if (matched.length === 0) {
      throw new Error(`Include pattern '${include}' in '${configPath}' matched no files`);
    }

    for (const entry of matched) {
      resolved.add(path.resolve(entry));
    }
  }

  return Array.from(resolved).sort();
}
export async function resolvePolicyPluginPaths(
  configPath: string,
  plugins: string[],
  context: PolicyLoadContext,
): Promise<string[]> {
  const resolved = new Set<string>();
  for (const plugin of plugins) {
    const pluginPaths = await resolvePolicyPluginPath(configPath, plugin, context);
    for (const pluginPath of pluginPaths) {
      resolved.add(path.resolve(pluginPath));
    }
  }

  return Array.from(resolved);
}
async function resolvePolicyPluginPath(
  configPath: string,
  plugin: string,
  context: PolicyLoadContext,
): Promise<string[]> {
  const trimmed = plugin.trim();
  if (trimmed.length === 0) return [];

  if (isPolicyPathReference(trimmed)) {
    return resolvePolicyPluginPathReferences(configPath, [trimmed], context);
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(trimmed)) {
    throw new Error(`Invalid policy plugin name '${plugin}' in '${configPath}'`);
  }

  const candidates = uniquePaths(policyPluginCandidates(configPath, trimmed, context));
  for (const candidate of candidates) {
    if (await isRegularFile(candidate)) {
      return [candidate];
    }
  }

  throw new Error(
    `Policy plugin '${plugin}' was not found from '${configPath}'. Checked: ${candidates.join(", ")}`,
  );
}

function isPolicyPathReference(value: string): boolean {
  return (
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("~/") ||
    path.isAbsolute(value) ||
    value.includes("/") ||
    value.includes("\\") ||
    value.endsWith(".toml") ||
    includeHasWildcard(value)
  );
}

function policyPluginCandidates(
  configPath: string,
  pluginName: string,
  context: PolicyLoadContext,
): string[] {
  const configDir = path.dirname(configPath);
  const names = [`.${pluginName}.toml`, `${pluginName}.toml`];
  const candidates: string[] = [];

  const pushUnder = (directory: string) => {
    for (const name of names) {
      candidates.push(path.join(directory, name));
    }
    for (const name of names) {
      candidates.push(path.join(directory, "plugins", name));
    }
  };

  if (path.basename(configDir) === PROJECT_GROUNDWORK_CONFIG_DIR) {
    pushUnder(configDir);
  }

  if (context.scope === "project") {
    pushUnder(path.join(context.rootDir, PROJECT_GROUNDWORK_CONFIG_DIR));
  }

  if (context.home) {
    pushUnder(path.join(context.home, GLOBAL_GROUNDWORK_CONFIG_DIR));
  }

  return candidates;
}

async function resolvePolicyPluginPathReferences(
  configPath: string,
  plugins: string[],
  context: PolicyLoadContext,
): Promise<string[]> {
  const configDir = path.dirname(configPath);
  const resolved = new Set<string>();

  for (const plugin of plugins) {
    const resolvedPlugin = resolvePolicyPluginPathReference(configDir, plugin, context);
    const hasWildcard = includeHasWildcard(resolvedPlugin);

    if (!hasWildcard) {
      resolved.add(path.resolve(resolvedPlugin));
      continue;
    }

    const matched = await expandIncludePattern(resolvedPlugin);
    if (matched.length === 0) {
      throw new Error(`Policy plugin pattern '${plugin}' in '${configPath}' matched no files`);
    }

    for (const entry of matched) {
      resolved.add(path.resolve(entry));
    }
  }

  return Array.from(resolved).sort();
}

function resolvePolicyPluginPathReference(
  configDir: string,
  plugin: string,
  context: PolicyLoadContext,
): string {
  if (plugin.startsWith("~/")) {
    if (!context.home) return plugin;
    return path.join(context.home, plugin.slice(2));
  }

  if (path.isAbsolute(plugin)) {
    return plugin;
  }

  return path.resolve(configDir, plugin);
}

function resolveIncludePath(configDir: string, include: string): string {
  if (include.startsWith("~/")) {
    const home = process.env.HOME;
    if (!home) return include;
    return path.join(home, include.slice(2));
  }

  if (path.isAbsolute(include)) {
    return include;
  }

  return path.resolve(configDir, include);
}

function includeHasWildcard(value: string): boolean {
  return value.includes("*") || value.includes("?");
}

async function expandIncludePattern(pattern: string): Promise<string[]> {
  const normalizedPattern = normalizeSlashes(path.resolve(pattern));
  const scanRoot = findPatternScanRoot(normalizedPattern);
  const candidates = await listFilesRecursive(scanRoot);

  return candidates
    .map((filePath) => normalizeSlashes(filePath))
    .filter((filePath) => globMatch(normalizedPattern, filePath))
    .sort();
}

function findPatternScanRoot(normalizedPattern: string): string {
  const wildcardIndex = normalizedPattern.search(/[*?]/);
  if (wildcardIndex < 0) {
    return path.dirname(normalizedPattern);
  }

  const lastSlashBeforeWildcard = normalizedPattern.lastIndexOf("/", wildcardIndex);
  if (lastSlashBeforeWildcard < 0) {
    return process.cwd();
  }

  const prefix = normalizedPattern.slice(0, lastSlashBeforeWildcard);
  if (prefix.length === 0) {
    return path.sep;
  }

  return prefix;
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export function mergeRulesWithDuplicateCheck(
  sources: Array<{ source: string; rules: GuardrailRule[] }>,
): GuardrailRule[] {
  const merged: GuardrailRule[] = [];
  const seen = new Map<string, string>();

  for (const source of sources) {
    for (const rule of source.rules) {
      const existingSource = seen.get(rule.id);
      if (existingSource) {
        throw new Error(
          `Duplicate rule id '${rule.id}' found in '${source.source}' and '${existingSource}'`,
        );
      }

      seen.set(rule.id, source.source);
      merged.push(rule);
    }
  }

  return merged;
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const candidate of paths) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    output.push(candidate);
  }
  return output;
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
